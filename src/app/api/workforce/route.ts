import { z } from "zod";
import { body, handle } from "@/lib/server/http";
import { createBot, updateBot, updateRoom } from "@/lib/server/service";
import { getBot, getRoom, setSetting } from "@/lib/server/db";
import { InputError } from "@/lib/server/errors";
import { defaultChatModel } from "@/lib/server/models";
import { redactSecrets } from "@/lib/server/memory-files";
import { profileFor, skills, toolCatalog, toolIds } from "@/lib/server/workforce/catalog";
import { changeRun, changeSchedule, decideApproval, saveSchedule, startEngine, startRun } from "@/lib/server/workforce/engine";
import { inspectMemory, memoryScopes } from "@/lib/server/workforce/memory";
import { draftAgent } from "@/lib/server/workforce/planning";
import { providerSettingKey, providers, settings, validateModel } from "@/lib/server/workforce/providers";
import { approvals, disabledSkillKey, disabledSkills, disabledToolKey, disabledTools, getAudit, getRun, runHistory, schedules } from "@/lib/server/workforce/store";
import { integrations, testIntegration } from "@/lib/server/workforce/tools";

const limited = (max: number) => z.string().trim().min(1).max(max);
const safe = (max: number) => limited(max).transform(redactSecrets);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const mode = z.enum(["mock", "live"]);
const run = z.object({
  roomId: id, instruction: safe(8000), mode, sequential: z.boolean(),
  planner: z.enum(["model", "rules"]).optional(),
  project: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,50}$/),
});
const provider = z.object({
  planning: z.string().max(160), defaultModel: z.string().max(160), fallback: z.string().max(160),
  maxOutputTokens: z.number().int().min(256).max(5000),
});
const action = z.discriminatedUnion("action", [
  run.extend({ action: z.literal("start"), csv: z.object({ name: safe(150), text: z.string().min(1).max(500_000) }).optional() }),
  z.object({ action: z.literal("change-run"), id, command: z.enum(["cancel", "retry", "amend"]), instruction: safe(8000).optional() }),
  z.object({ action: z.literal("approval"), id, taskId: id, approve: z.boolean() }),
  run.extend({ action: z.literal("create-schedule"), name: safe(90), intervalMinutes: z.number().int().min(1).max(43_200) }),
  z.object({ action: z.literal("change-schedule"), id, command: z.enum(["run", "pause", "resume"]) }),
  z.object({ action: z.literal("memory"), scope: z.enum(memoryScopes), id: z.string().max(50), markdown: z.string().max(128_000) }),
  provider.extend({ action: z.literal("providers") }),
  z.object({ action: z.literal("catalog"), disabled: z.array(z.enum(toolIds)).max(toolIds.length), skills: z.array(z.string()).max(8) }),
  z.object({ action: z.literal("integration-test"), id: z.enum(["github", "deepwiki", "learn", "slack", "tavily", "public-web"]) }),
  z.object({ action: z.literal("agent"), description: safe(2500), mode, roomId: id.optional() }),
  z.object({ action: z.literal("clone-agent"), id }),
  z.object({
    action: z.literal("agent-profile"), id, approval: z.enum(["ask", "controlled", "full"]),
    skills: z.array(z.string()).max(8), allowedTools: z.array(z.enum(toolIds)).max(toolIds.length), preapproved: z.array(z.enum(toolIds)).max(toolIds.length),
    outputFormat: safe(500), model: z.string().max(160), disabled: z.boolean(),
  }),
]);

function validateSkills(ids: string[]) {
  if (!ids.every((value) => skills.some((skill) => skill.id === value))) throw new InputError("Unknown skill.");
}

export async function GET(request: Request) {
  return handle(async () => {
    await startEngine();
    const params = new URL(request.url).searchParams;
    const runId = params.get("id");
    const scope = params.get("scope");
    if (scope) return inspectMemory(scope as Parameters<typeof inspectMemory>[0], params.get("owner") ?? "");
    if (runId) {
      const selected = await getRun(runId);
      if (!selected) throw new InputError("Run does not exist.");
      const { csv, ...details } = selected.input;
      return { run: { ...selected, input: { ...details, attachment: csv?.name }, priorContext: undefined }, audit: await getAudit(runId) };
    }
    if (params.get("view") === "config") return {
      schedules: await schedules(), integrations: integrations(), providers: providers(), settings: await settings(),
      tools: toolCatalog, skills, disabled: await disabledTools(), disabledSkills: await disabledSkills(),
    };
    if (params.get("view") === "approvals") return { approvals: await approvals(), audit: await getAudit() };
    return { runs: await runHistory((params.get("q") ?? "").slice(0, 180)) };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    await startEngine();
    const parsed = action.safeParse(await body<unknown>(request));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new InputError(`Invalid Workforce request (${first.path.join(".") || "body"}): ${first.message}`);
    }
    const input = parsed.data;
    switch (input.action) {
      case "start": {
        const selected = await startRun({ ...run.parse(input), csv: input.csv });
        return { id: selected.id };
      }
      case "change-run": {
        const selected = await changeRun(input.id, input.command, input.instruction);
        return { id: selected.id };
      }
      case "approval":
        await decideApproval(input.id, input.taskId, input.approve);
        return { ok: true };
      case "create-schedule":
        return { schedule: await saveSchedule(input.name, run.parse(input), input.intervalMinutes) };
      case "change-schedule": {
        const result = await changeSchedule(input.id, input.command);
        return { id: result.run?.id, schedule: result.schedule };
      }
      case "memory":
        return inspectMemory(input.scope, input.id, input.markdown);
      case "providers": {
        const config = provider.parse(input);
        [config.planning, config.defaultModel, config.fallback].forEach(validateModel);
        await setSetting(providerSettingKey, config);
        return { ok: true };
      }
      case "catalog":
        validateSkills(input.skills);
        await setSetting(disabledToolKey, [...new Set(input.disabled)]);
        await setSetting(disabledSkillKey, [...new Set(input.skills)]);
        return { ok: true };
      case "integration-test":
        return { output: await testIntegration(input.id, AbortSignal.timeout(22_000)) };
      case "agent": {
        const room = input.roomId ? await getRoom(input.roomId) : undefined;
        if (input.roomId && !room) throw new InputError("Room does not exist.");
        const draft = await draftAgent(input.description, input.mode, AbortSignal.timeout(52_000));
        const bot = await createBot({
          name: draft.name, title: draft.title, instructions: draft.instructions, description: input.description.slice(0, 200),
          emoji: "", color: "#3b82f6", model: defaultChatModel(), pinned: false, approval: "ask", workforce: draft.workforce,
          tools: { webSearch: draft.workforce.allowedTools.includes("web_search"), memory: true, codeMode: false, browser: false, askUser: true },
        });
        if (room) await updateRoom(room.id, { memberIds: [...room.memberIds, bot.id] });
        return { bot };
      }
      case "clone-agent": {
        const bot = await getBot(input.id);
        if (!bot) throw new InputError("Agent does not exist.");
        const clone = { ...bot, name: `${bot.name.slice(0, 32)} copy`, handle: undefined, pinned: false, connections: [], approval: "ask" as const };
        return { bot: await createBot({ ...clone, workforce: { ...profileFor(bot), preapproved: [], disabled: false } }) };
      }
      case "agent-profile": {
        const bot = await getBot(input.id);
        if (!bot) throw new InputError("Agent does not exist.");
        validateSkills(input.skills);
        validateModel(input.model);
        const allowed = [...new Set(input.allowedTools)];
        return { bot: await updateBot(input.id, {
          approval: input.approval,
          tools: { ...bot.tools, webSearch: allowed.some((entry) => entry === "web_search" || entry === "web_extract") },
          workforce: {
            skills: [...new Set(input.skills)], allowedTools: allowed,
            preapproved: [...new Set(input.preapproved)].filter((entry) => allowed.includes(entry) && toolCatalog[entry].access === "read"),
            outputFormat: input.outputFormat, model: input.model || undefined, disabled: input.disabled,
          },
        }) };
      }
      default:
        throw new InputError(`Unknown action ${(input as { action?: string }).action}.`);
    }
  });
}
