import { listBots, listRooms, getSetting, saveBot, saveRoom, setSetting } from "../db";
import { defaultChatModel } from "../models";
import { readMemory, writeMemory } from "../memory-files";
import type { Bot, Room } from "@/lib/shared/types";
import type { ToolId } from "@/lib/shared/workforce";

const roster: [string, string, string, string[], ToolId[], string, string][] = [
  ["scout", "Scout", "Market Research", ["market-research", "competitor-analysis"], ["web_search", "web_extract"], "#3478f6", "Find primary evidence and cite exact sources."],
  ["quill", "Quill", "Campaign & Copy", ["email-drafting", "presentation-creation"], ["slack_post"], "#e0663d", "Draft usable campaign concepts, calendars and sample assets."],
  ["atlas", "Atlas", "Chief of Staff", [], [], "#1f9d6b", "Coordinate specialists and deliver the requested outcome."],
  ["signal", "Signal", "Competitive Intelligence", ["competitor-analysis", "market-research"], ["web_search", "web_extract"], "#8869ee", "Compare offerings, audiences, positioning and published prices."],
  ["ledger", "Ledger", "Sales & Finance", ["data-analysis", "financial-modelling"], ["csv"], "#20a89e", "Analyze actual data using explicit denominators and segment totals."],
  ["forge", "Forge", "Engineering Review", ["code-review"], ["github_read", "deepwiki", "learn_docs", "github_issue"], "#7096ef", "Inspect repository evidence defensively and prioritize maintainability improvements."],
  ["reach", "Reach", "Partnerships", ["lead-generation", "market-research"], ["web_search", "web_extract"], "#bf668b", "Identify organizations and document the evidence for each partnership fit."],
  ["verifier", "Verifier", "Quality Review", ["data-analysis", "code-review"], ["csv", "github_read", "deepwiki", "learn_docs"], "#bc9651", "Challenge unsupported claims and identify missing verification."],
];
const groups: [string, string, string, string[]][] = [
  ["studio", "Studio", "Campaigns, audience research and content strategy", ["atlas", "quill", "scout", "verifier"]],
  ["market-intelligence", "Market Intelligence", "Competitive research and partnerships", ["atlas", "scout", "signal", "reach", "verifier"]],
  ["business-operations", "Business Operations", "Data analysis, reporting and repeatable routines", ["atlas", "ledger", "quill", "verifier"]],
  ["engineering", "Engineering", "Repository review and development plans", ["atlas", "forge", "verifier"]],
];

export async function seedWorkforce() {
  if (await getSetting("workforce.seeded")) return;
  const existing = new Map((await listBots()).map((bot) => [bot.handle, bot]));
  const ids = new Map<string, string>();
  const createdAt = new Date().toISOString();
  for (const [handle, name, title, skills, allowedTools, color, instructions] of roster) {
    const old = existing.get(handle);
    const workforce = { skills, allowedTools, preapproved: [], outputFormat: "Markdown with findings, evidence and next steps." };
    const bot: Bot = old ? { ...old, workforce: old.workforce ?? workforce } : {
      id: `wf-${handle}`, handle, name, title, description: instructions, instructions,
      color, emoji: "", model: defaultChatModel(), approval: "ask", pinned: false, connections: [],
      tools: { memory: true, webSearch: allowedTools.includes("web_search"), codeMode: false, browser: false, askUser: true },
      workforce, createdAt,
    };
    await saveBot(bot);
    ids.set(handle, bot.id);
    if (!readMemory(bot.id)) writeMemory(bot.id, `# ${bot.name}'s memory\n`);
  }
  const rooms = await listRooms();
  for (const [id, name, topic, handles] of groups) {
    const memberIds = handles.map((handle) => ids.get(handle)!);
    const old = rooms.find((room) => room.name === name);
    const room: Room = old ? { ...old, memberIds: [...new Set([...old.memberIds, ...memberIds])] } : {
      id: `wf-${id}`, name, topic, memberIds, leadId: memberIds[0], responder: "auto", pinned: id === "studio", emoji: "", createdAt,
    };
    await saveRoom(room);
  }
  await setSetting("workforce.seeded", true);
}
