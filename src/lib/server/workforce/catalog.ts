import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bot } from "@/lib/shared/types";
import type { ToolId, WorkforceProfile } from "@/lib/shared/workforce";

export const toolCatalog = {
  csv: { label: "Analyze attached CSV", description: "No arguments. Calculates grouped funnel metrics and renders a chart.", access: "local" },
  web_search: { label: "Search the web", description: "Tavily search. Args: query.", access: "read" },
  web_extract: { label: "Read a public web page", description: "Read a public HTTPS URL. Args: url. Can run without a Tavily key.", access: "read" },
  github_read: { label: "Inspect GitHub repository", description: "README, metadata, open issues and tree, or a specific file. Args: repo (owner/name), optional path.", access: "read" },
  github_issue: { label: "Create GitHub issue", description: "Always requires approval. Args: repo, title, body. Requires explicit write intent.", access: "write" },
  deepwiki: { label: "Read DeepWiki repository docs", description: "Read-only MCP documentation structure. Args: repo (owner/name).", access: "read" },
  learn_docs: { label: "Search Microsoft Learn", description: "Search Microsoft Learn technical documentation over MCP. Args: query.", access: "read" },
  slack_post: { label: "Post Slack message", description: "Always requires approval. Args: channel (ID), text. Requires explicit send intent.", access: "write" },
} satisfies Record<ToolId, { label: string; description: string; access: "local" | "read" | "write" }>;

export const toolIds = Object.keys(toolCatalog) as ToolId[];

const skillList = [
  ["market-research", "Market Research", ["web_search", "web_extract"]],
  ["competitor-analysis", "Competitor Analysis", ["web_search", "web_extract"]],
  ["financial-modelling", "Financial Modelling", ["csv"]],
  ["presentation-creation", "Presentation Creation", []],
  ["email-drafting", "Email Drafting", []],
  ["code-review", "Code Review", ["github_read", "deepwiki", "learn_docs", "github_issue"]],
  ["data-analysis", "Data Analysis", ["csv"]],
  ["lead-generation", "Lead Generation", ["web_search", "web_extract"]],
] satisfies [string, string, ToolId[]][];

export const skills = skillList.map(([id, name, tools]) => ({ id, name, tools }));

export function skillInstructions(id?: string): string {
  if (!id || !skills.some((skill) => skill.id === id)) return "";
  return readFileSync(join(process.cwd(), "skills", `${id}.md`), "utf8").slice(0, 4500);
}

export function profileFor(bot: Bot): WorkforceProfile {
  return bot.workforce ?? {
    skills: [],
    allowedTools: ["csv", "github_read", "deepwiki", ...(bot.tools.webSearch ? ["web_search", "web_extract"] as const : [])],
    preapproved: [],
    outputFormat: "Markdown with evidence and open questions.",
  };
}

export function allowedTools(bot: Bot, disabled: ToolId[]) {
  return profileFor(bot).allowedTools.filter((id) => !disabled.includes(id) &&
    (!(id === "web_search" || id === "web_extract") || bot.tools.webSearch));
}

export function needsApproval(bot: Bot, id: ToolId): boolean {
  if (toolCatalog[id].access === "write") return true;
  if (toolCatalog[id].access === "local" || bot.approval === "full") return false;
  return bot.approval === "ask" || !profileFor(bot).preapproved.includes(id);
}
