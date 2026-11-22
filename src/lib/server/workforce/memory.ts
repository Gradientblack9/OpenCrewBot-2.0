import { getBot, getRoom } from "../db";
import { InputError } from "../errors";
import { appendMemory, memoryForPrompt, memoryPath, readMemory, writeMemory } from "../memory-files";
import type { MemoryScope, WorkRun } from "@/lib/shared/workforce";

export const memoryScopes: MemoryScope[] = ["agent", "room", "project", "preferences", "decisions", "history"];

function storageId(scope: MemoryScope, id: string) {
  if (scope === "agent") return id;
  if (scope === "room" || scope === "project") return `wf-${scope}-${id}`;
  return `wf-${scope}`;
}

export async function inspectMemory(scope: MemoryScope, id: string, content?: string) {
  if (!memoryScopes.includes(scope)) throw new InputError("Invalid memory scope.");
  if (["agent", "room", "project"].includes(scope) && !/^[a-zA-Z0-9_-]{1,50}$/.test(id)) throw new InputError("Select a valid memory owner.");
  if (scope === "agent" && !(await getBot(id))) throw new InputError("Agent does not exist.");
  if (scope === "room" && !(await getRoom(id))) throw new InputError("Room does not exist.");
  const storage = storageId(scope, id);
  if (content !== undefined) {
    if (Buffer.byteLength(content) > 128_000) throw new InputError("Keep memory under 128 KB.");
    writeMemory(storage, content);
    appendMemory(`wf-provenance-${storage}`, "Edited by the local owner in the Workforce memory manager.", "Edits");
  }
  return { path: memoryPath(storage), markdown: readMemory(storage), provenance: readMemory(`wf-provenance-${storage}`) };
}

export function runMemory(run: WorkRun, botId?: string): string {
  const main: [MemoryScope, string][] = [
    ["room", run.input.roomId], ["project", run.input.project], ["preferences", ""], ["decisions", ""],
  ];
  if (botId) main.unshift(["agent", botId]);
  const context = main.map(([scope, id]) => {
    const { text } = memoryForPrompt(storageId(scope, id));
    return text ? `[${scope}]\n${text.slice(0, 2600)}` : "";
  }).filter(Boolean);
  const history = readMemory(storageId("history", ""))
    .split("\n").filter((line) => line.startsWith(`- [${run.input.project}]`)).slice(-4).join("\n").slice(-1800);
  if (history) context.push(`[historical task context]\n${history}`);
  return context.join("\n\n");
}

export function recordHistory(run: WorkRun) {
  const history = storageId("history", "");
  const note = `- [${run.input.project}] ${run.updatedAt} • Run ${run.id} ${run.status}. Historical task context: ${run.input.instruction.slice(0, 240).replace(/\s+/g, " ")}`;
  const old = readMemory(history);
  if (!old.includes(`Run ${run.id} `)) writeMemory(history, `${old.split("\n").filter(Boolean).slice(-199).join("\n")}\n${note}\n`.trimStart());
}
