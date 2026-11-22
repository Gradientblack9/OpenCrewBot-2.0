import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { getMcpCallToolContent, MCPClient } from "@mastra/mcp";
import { z } from "zod";
import type { RunInput, TaskOutput, ToolCall, ToolId } from "@/lib/shared/workforce";
import { InputError } from "../errors";
import { redactSecrets } from "../memory-files";
import { analyzeCsv } from "./csv";
import { toolCatalog } from "./catalog";
import { extractPublicPage } from "./public-page";

const repo = z.string().regex(/^[A-Za-z0-9-]{1,39}\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/);
const arg = (max: number) => z.string().trim().min(1).max(max);
const schemas = {
  csv: z.object({}).strict(),
  web_search: z.object({ query: arg(380) }).strict(),
  web_extract: z.object({ url: z.url({ protocol: /^https$/ }).max(1500).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && !url.port && !isIP(url.hostname) && url.hostname.includes(".");
  }) }).strict(),
  github_read: z.object({ repo, path: z.string().max(200).regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/)
    .refine((path) => !path.split("/").some((segment) => segment === "." || segment === "..")).optional() }).strict(),
  deepwiki: z.object({ repo }).strict(),
  github_issue: z.object({ repo, title: arg(200), body: arg(5000) }).strict(),
  learn_docs: z.object({ query: arg(380) }).strict(),
  slack_post: z.object({ channel: z.string().regex(/^[CGD][A-Z0-9]{7,20}$/), text: arg(4000) }).strict(),
} satisfies Record<ToolId, z.ZodType>;

export function validateCall(call: ToolCall, input: RunInput): ToolCall {
  const result = schemas[call.id].safeParse(call.args);
  if (!result.success) throw new InputError(`Invalid arguments for ${toolCatalog[call.id].label}.`);
  if (call.id === "csv" && !input.csv) throw new InputError("A CSV attachment is needed.");
  if (toolCatalog[call.id].access === "write" && !/\b(send|post|publish|create|open|file)\b/i.test(input.instruction)) {
    throw new InputError("An external write must be explicitly requested.");
  }
  return { id: call.id, args: Object.fromEntries(Object.entries(result.data).map(([key, value]) => [key, redactSecrets(String(value))])) };
}

async function requestJson(url: string, options: RequestInit, service: string, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(url, { ...options, redirect: "error", signal });
  } catch {
    signal.throwIfAborted();
    throw new Error(`${service} could not be reached.`);
  }
  if (!response.ok) throw new Error(`${service} returned HTTP ${response.status}.`);
  return response.json();
}

const githubHeaders = (write = false) => ({
  Accept: "application/vnd.github+json",
  "User-Agent": "OpenCrewBot",
  "Content-Type": "application/json",
  ...(write && process.env.WORKFORCE_GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.WORKFORCE_GITHUB_TOKEN}` } : {}),
});
const githubUrl = (value: string) => `https://api.github.com/repos/${value}`;
const slackHeaders = () => {
  if (!process.env.WORKFORCE_SLACK_TOKEN) throw new InputError("Slack requires WORKFORCE_SLACK_TOKEN.");
  return { Authorization: `Bearer ${process.env.WORKFORCE_SLACK_TOKEN}`, "Content-Type": "application/json" };
};

const publicMcp = {
  deepwiki: { url: "https://mcp.deepwiki.com/mcp", tool: "read_wiki_structure", name: "DeepWiki" },
  learn: { url: "https://learn.microsoft.com/api/mcp?maxTokenBudget=2500", tool: "microsoft_docs_search", name: "Microsoft Learn" },
};

async function callPublicMcp(id: keyof typeof publicMcp, args: Record<string, string>, signal: AbortSignal) {
  const definition = publicMcp[id];
  const client = new MCPClient({
    id: `workforce-${randomUUID()}`, timeout: 15_000,
    servers: { [id]: { url: new URL(definition.url), protocolVersion: "legacy", onToolError: "throw", requestInit: { signal } } },
  });
  const abort = () => { void client.disconnect().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const server = client.toMCPServerProxies()[id];
    const available = await server.getToolListInfo();
    if (!available.tools.some((tool) => tool.name === definition.tool)) throw new InputError(`${definition.name} documentation tool is unavailable.`);
    const result = await server.executeTool(definition.tool, args);
    if (result.status !== "completed") throw new InputError(`${definition.name} requires unsupported user interaction.`);
    const partSchema = z.array(z.object({ type: z.string(), text: z.string().optional() }));
    const envelope = z.object({ content: partSchema, isError: z.boolean().optional() }).safeParse(result.output);
    const structured = partSchema.safeParse(getMcpCallToolContent(result.output));
    if (envelope.success && envelope.data.isError) throw new InputError(`${definition.name} could not retrieve documentation.`);
    if (id === "learn") {
      const search = z.object({
        results: z.array(z.object({ title: z.string(), content: z.string(), url: z.string().optional() })),
      }).safeParse(result.output);
      if (search.success && search.data.results.length) {
        return search.data.results.map((entry) => [`### ${entry.title}`, entry.url, entry.content].filter(Boolean).join("\n")).join("\n\n");
      }
    }
    const parts = structured.success ? structured.data : envelope.success ? envelope.data.content : [];
    const snippets = parts.filter((part) => part.type === "text" && part.text).map((part) => part.text);
    if (!snippets.length) throw new InputError(`${definition.name} returned no documentation.`);
    return snippets.join("\n");
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof InputError) throw error;
    throw new Error(`${definition.name} could not complete the MCP request.`);
  } finally {
    signal.removeEventListener("abort", abort);
    await client.disconnect().catch(() => {});
  }
}

const live = (markdown: string): TaskOutput => ({ mode: "LIVE", markdown: redactSecrets(markdown).slice(0, 15_000) });

export async function executeTool(raw: ToolCall, input: RunInput, signal: AbortSignal): Promise<TaskOutput> {
  const { id, args } = validateCall(raw, input);
  signal.throwIfAborted();
  if (id === "csv" && input.csv) return analyzeCsv(input.csv.name, input.csv.text);
  if (input.mode === "mock") {
    return { mode: "SIMULATED", markdown: `Simulation only. No service was contacted. Operation: ${toolCatalog[id].label}.\n\n${JSON.stringify(args, null, 2)}`.slice(0, 7000) };
  }

  switch (id) {
    case "web_search":
    case "web_extract": {
      const key = process.env.TAVILY_API_KEY;
      const search = id === "web_search";
      if (!key && !search) return live(await extractPublicPage(args.url, signal));
      if (!key) throw new InputError("Discovery search needs TAVILY_API_KEY. Supply public HTTPS sources for key-free page reads.");
      const data = await requestJson(`https://api.tavily.com/${search ? "search" : "extract"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(search ? { query: args.query, max_results: 5 } : { urls: [args.url] }),
      }, "Tavily", signal);
      const results: { title?: string; url: string; content?: string; raw_content?: string }[] = data.results ?? [];
      if (!results.length) throw new InputError("Tavily returned no evidence for this request.");
      return live(results.map((result) => `### ${result.title || result.url}\n${result.url}\n\n${(result.content || result.raw_content || "").slice(0, 2500)}`).join("\n\n"));
    }
    case "github_read": {
      const base = githubUrl(args.repo);
      const get = (path: string) => requestJson(base + path, { headers: githubHeaders() }, "GitHub", signal);
      const info = await get("");
      const branch = encodeURIComponent(info.default_branch);
      const optional = (path: string) => get(path).catch((error: Error) => {
        if (error.message === "GitHub returned HTTP 404.") return null;
        throw error;
      });
      if (args.path) {
        const path = args.path.split("/").map(encodeURIComponent).join("/");
        const file = await get(`/contents/${path}?ref=${branch}`);
        if (file.type !== "file" || file.encoding !== "base64") throw new InputError("GitHub did not return a readable file at this path.");
        return live(`### ${info.full_name} / ${args.path}\n${info.html_url}/blob/${branch}/${path}\n\n${Buffer.from(file.content, "base64").toString("utf8").slice(0, 7200)}`);
      }
      const [readme, tree, issues] = await Promise.all([optional("/readme"), optional(`/git/trees/${branch}`), optional("/issues?state=open&per_page=8")]);
      const notes = readme?.encoding === "base64" ? Buffer.from(readme.content, "base64").toString("utf8").slice(0, 7200) : "README unavailable.";
      const paths = (tree?.tree ?? []).slice(0, 50).map((entry: { path: string }) => entry.path);
      const files = paths.filter((path: string) => /^(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|next\.config\.[a-z]+|tsconfig\.json)$/.test(path)).slice(0, 2);
      const excerpts = await Promise.all(files.map(async (path: string) => {
        const entry = await optional(`/contents/${encodeURIComponent(path)}?ref=${branch}`);
        if (entry?.encoding !== "base64") return "";
        return `### ${path}\n${info.html_url}/blob/${branch}/${path}\n\n${Buffer.from(entry.content, "base64").toString("utf8").slice(0, 2100)}`;
      }));
      const open = (Array.isArray(issues) ? issues : []).filter((issue) => !issue.pull_request).map((issue) => `- #${issue.number} ${issue.title} — ${issue.html_url}`).join("\n");
      return live(`### ${info.full_name}\n${info.html_url}\n\n${info.description ?? ""}\n\nDefault branch: ${info.default_branch}\n\nRoot paths: ${paths.join(", ") || "Unavailable"}\n\n### Open issues in the retrieved page\n${open || "None found"}\n\n### README excerpt\n${notes}\n\n${excerpts.filter(Boolean).join("\n\n")}`);
    }
    case "github_issue": {
      if (!process.env.WORKFORCE_GITHUB_TOKEN) throw new InputError("GitHub writes require WORKFORCE_GITHUB_TOKEN.");
      const result = await requestJson(`${githubUrl(args.repo)}/issues`, {
        method: "POST", headers: githubHeaders(true), body: JSON.stringify({ title: args.title, body: args.body }),
      }, "GitHub", signal);
      return live(`Created issue #${result.number} — ${result.html_url}`);
    }
    case "deepwiki":
      return live(`https://deepwiki.com/${args.repo}\n\n${await callPublicMcp("deepwiki", { repoName: args.repo }, signal)}`);
    case "learn_docs":
      return live(await callPublicMcp("learn", { query: args.query }, signal));
    case "slack_post": {
      const result = await requestJson("https://slack.com/api/chat.postMessage", {
        method: "POST", headers: slackHeaders(), body: JSON.stringify({ channel: args.channel, text: args.text, unfurl_links: false, unfurl_media: false }),
      }, "Slack", signal);
      if (!result.ok) throw new InputError("Slack rejected the message. Check the target channel and chat:write scope.");
      return live(`Posted message to Slack channel ${result.channel}. Timestamp: ${result.ts}.`);
    }
    default:
      throw new InputError("Tool unavailable.");
  }
}

export function integrations() {
  return [
    { id: "github", name: "GitHub", ready: true, scopes: "Public repository read. Issues write requires a repository-scoped token and approval." },
    { id: "deepwiki", name: "DeepWiki MCP", ready: true, scopes: "Public repository documentation read." },
    { id: "learn", name: "Microsoft Learn MCP", ready: true, scopes: "Public Microsoft technical documentation search." },
    { id: "slack", name: "Slack", ready: Boolean(process.env.WORKFORCE_SLACK_TOKEN), scopes: "chat:write. The bot must have access to the destination channel." },
    { id: "tavily", name: "Tavily", ready: Boolean(process.env.TAVILY_API_KEY), scopes: "Search and page extraction." },
    { id: "public-web", name: "Public web", ready: true, scopes: "Read public HTTPS text without an API key." },
  ];
}

export async function testIntegration(id: string, signal: AbortSignal) {
  if (id === "public-web") return live(await extractPublicPage("https://www.meetuniversity.com/about", signal));
  if (id === "github") {
    const result = await requestJson(githubUrl("Studio1-OSS/OpenCrewBot"), { headers: githubHeaders() }, "GitHub", signal);
    return live(`Verified public repository read: ${result.full_name}.`);
  }
  if (id === "deepwiki") {
    const content = await callPublicMcp("deepwiki", { repoName: "microsoft/TypeScript" }, signal);
    return live(`Retrieved repository documentation from DeepWiki.\n\n${content.slice(0, 1200)}`);
  }
  if (id === "learn") {
    const content = await callPublicMcp("learn", { query: "TypeScript Azure Functions developer guide" }, signal);
    return live(`Retrieved Microsoft Learn search results.\n\n${content.slice(0, 1200)}`);
  }
  if (id === "slack") {
    const result = await requestJson("https://slack.com/api/auth.test", { method: "POST", headers: slackHeaders() }, "Slack", signal);
    if (!result.ok) throw new InputError("Slack did not accept the configured token.");
    return live(`Slack authenticated to workspace ${result.team}.`);
  }
  if (id === "tavily") return executeTool({ id: "web_search", args: { query: "Studio1 OSS OpenCrewBot GitHub" } },
    { mode: "live", roomId: "", instruction: "Test search connectivity.", project: "", sequential: false }, signal);
  throw new InputError("Unknown integration.");
}
