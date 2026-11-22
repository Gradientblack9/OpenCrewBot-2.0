import { randomUUID } from "node:crypto";
import type { AuditEvent, RunInput, Schedule, TaskOutput, WorkRun, WorkTask } from "@/lib/shared/workforce";
import { getBot, getRoom, listBots } from "../db";
import { InputError } from "../errors";
import { redactSecrets } from "../memory-files";
import { allowedTools, needsApproval, profileFor, toolCatalog } from "./catalog";
import { recordHistory } from "./memory";
import { createPlan, performTask } from "./planning";
import { settings } from "./providers";
import { commit, disabledSkills, disabledTools, getRun, getSchedule, schedules, workingRuns } from "./store";
import { executeTool } from "./tools";

const maximumAttempts = 3;
const workers = 4;
const activeStatuses = ["planning", "running", "waiting"];
const terminal = (task: WorkTask) => !["queued", "running", "approval"].includes(task.status);
const externalWrite = (task: WorkTask) => task.tool && toolCatalog[task.tool.id].access === "write";
const now = () => new Date().toISOString();
const taskKey = (runId: string, taskId?: string) => `${runId}/${taskId ?? "plan"}`;

const g = globalThis as unknown as {
  __workforce?: { boot?: Promise<void>; tail: Promise<unknown>; active: Map<string, AbortController>; timer?: NodeJS.Timeout };
};
const state: NonNullable<typeof g.__workforce> = (g.__workforce ??= { tail: Promise.resolve(), active: new Map() });

function serialized<T>(action: () => Promise<T>): Promise<T> {
  const pending = state.tail.then(action);
  state.tail = pending.catch(() => undefined);
  return pending;
}

function audit(run: WorkRun, event: string, detail: string, task?: WorkTask): AuditEvent {
  return { runId: run.id, taskId: task?.id, at: now(), event, detail };
}

function refreshStatus(run: WorkRun) {
  run.updatedAt = now();
  if (run.status === "cancelled" || !run.tasks.length) return;
  run.status = run.tasks.every(terminal)
    ? run.tasks.some((task) => task.status === "failed") ? "failed" : "completed"
    : run.tasks.some((task) => task.status === "approval") ? "waiting" : "running";
  if (!activeStatuses.includes(run.status)) run.finishedAt = run.updatedAt;
}

async function save(run: WorkRun, events: AuditEvent[]) {
  const alreadyFinished = !!run.finishedAt;
  refreshStatus(run);
  if (run.finishedAt && !alreadyFinished) events.push(audit(run, `run_${run.status}`, "All workstreams reached a terminal state."));
  await commit([{ run, audit: events }]);
  if (run.finishedAt && !alreadyFinished) {
    try { recordHistory(run); } catch { console.error("[workforce] could not update Markdown history"); }
  }
}

function create(input: RunInput, extra: Partial<WorkRun> = {}): WorkRun {
  return { id: randomUUID(), input, status: "planning", tasks: [], planningAttempts: 0, createdAt: now(), updatedAt: now(), ...extra };
}

async function requireRoom(id: string) {
  const room = await getRoom(id);
  if (!room) throw new InputError("Select an existing room.");
  return room;
}

export function startRun(input: RunInput) {
  return serialized(async () => {
    await requireRoom(input.roomId);
    const run = create(input);
    await commit([{ run, isNew: true, audit: [audit(run, "run_created", "Submitted by the local owner.")] }]);
    return run;
  });
}

function cancel(run: WorkRun) {
  const events: AuditEvent[] = [];
  const at = now();
  for (const task of run.tasks.filter((task) => !terminal(task))) {
    if (task.approval?.status === "pending" || task.approval?.status === "approved") {
      task.approval = { status: "cancelled", at };
    }
    task.status = "cancelled";
    task.finishedAt = at;
    task.error = task.dispatchedAt && externalWrite(task) && !task.toolOutput
      ? "External action was already dispatched. Verify its outcome at the destination." : undefined;
    events.push(audit(run, "task_cancelled", task.error ?? "Cancelled by the local owner.", task));
  }
  run.status = "cancelled";
  run.finishedAt = run.updatedAt = at;
  events.push(audit(run, "run_cancelled", "Cancelled by the local owner."));
  return events;
}

function abortRun(id: string) {
  for (const [key, controller] of state.active) {
    if (key.startsWith(`${id}/`)) controller.abort();
  }
}

export function changeRun(id: string, command: "cancel" | "retry" | "amend", change?: string) {
  return serialized(async () => {
    const run = await getRun(id);
    if (!run) throw new InputError("Run does not exist.");
    if (command === "cancel") {
      if (!activeStatuses.includes(run.status)) throw new InputError("The run is already finished.");
      await commit([{ run, audit: cancel(run) }]);
      abortRun(id);
      return run;
    }
    if (command === "amend") {
      if (!change?.trim()) throw new InputError("Enter the revised instruction.");
      const priorContext = [
        run.input.instruction,
        ...run.tasks.filter((task) => task.status === "done").map((task) => `${task.title}\n${task.output?.markdown.slice(0, 650)}`),
      ].join("\n\n").slice(0, 4500);
      const next = create({ ...run.input, instruction: change }, { parentId: run.id, priorContext });
      const events = activeStatuses.includes(run.status) ? cancel(run) : [];
      await commit([
        { run, audit: [...events, audit(run, "run_amended", `Successor ${next.id}.`)] },
        { run: next, isNew: true, audit: [audit(next, "run_created", `Replanned from ${run.id} with completed handoffs carried forward.`)] },
      ]);
      abortRun(run.id);
      return next;
    }
    if (run.status !== "failed") throw new InputError("Only failed runs can be retried.");
    const failed = run.tasks.filter((task) => task.status === "failed" && (!externalWrite(task) || !task.dispatchedAt || task.toolOutput));
    if (run.tasks.length && !failed.length) throw new InputError("There are no safe steps to retry. Resolve the dispatched action at its destination.");
    const reset = new Set(failed.map(({ id }) => id));
    for (const task of run.tasks) {
      if (reset.has(task.id) || (task.status !== "rejected" && task.dependencies.some((dep) => reset.has(dep)))) {
        reset.add(task.id);
        task.status = "queued";
        task.attempts = 0;
        task.error = task.output = task.finishedAt = task.startedAt = task.retryAt = undefined;
      }
    }
    run.finishedAt = undefined;
    run.planningAttempts = 0;
    run.planningRetryAt = run.error = undefined;
    run.status = run.tasks.length ? "running" : "planning";
    await save(run, [audit(run, "run_retried", "Requeued safe failed work and dependent outputs.")]);
    return run;
  });
}

export function decideApproval(runId: string, taskId: string, approve: boolean) {
  return serialized(async () => {
    const run = await getRun(runId);
    const task = run?.tasks.find((item) => item.id === taskId);
    if (!run || !task || task.status !== "approval" || !task.tool || task.approval?.status !== "pending") {
      throw new InputError("This approval is no longer pending.");
    }
    task.approval = { status: approve ? "approved" : "rejected", at: now() };
    task.status = approve ? "queued" : "rejected";
    if (!approve) {
      task.finishedAt = now();
      task.error = "Rejected by the local owner. The tool was never dispatched.";
    }
    await save(run, [audit(run, approve ? "approval_granted" : "approval_rejected", JSON.stringify(task.tool), task)]);
    return run;
  });
}

export function saveSchedule(name: string, input: Schedule["input"], intervalMinutes: number) {
  return serialized(async () => {
    await requireRoom(input.roomId);
    const schedule: Schedule = { id: randomUUID(), name, input, intervalMinutes, nextAt: new Date(Date.now() + intervalMinutes * 60_000).toISOString(), paused: false };
    await commit([], schedule);
    return schedule;
  });
}

export function changeSchedule(id: string, command: "run" | "pause" | "resume") {
  return serialized(async () => {
    const schedule = await getSchedule(id);
    if (!schedule) throw new InputError("Schedule does not exist.");
    if (command === "run") {
      await requireRoom(schedule.input.roomId);
      const run = create(schedule.input, { scheduleId: id });
      await commit([{ run, isNew: true, audit: [audit(run, "run_created", `Manually triggered from ${schedule.name}.`)] }]);
      return { schedule, run };
    }
    schedule.paused = command === "pause";
    if (!schedule.paused) schedule.nextAt = new Date(Date.now() + schedule.intervalMinutes * 60_000).toISOString();
    await commit([], schedule);
    return { schedule };
  });
}

async function scheduleReady(at: string) {
  for (const schedule of await schedules()) {
    if (schedule.paused || schedule.nextAt > at) continue;
    const slot = schedule.nextAt;
    schedule.nextAt = new Date(Date.now() + schedule.intervalMinutes * 60_000).toISOString();
    const run = create(schedule.input, { scheduleId: schedule.id });
    await commit([{ run, isNew: true, slot, audit: [audit(run, "run_created", `Scheduled for ${slot} by ${schedule.name}.`)] }], schedule);
  }
}

function failureMessage(error: unknown, controller: AbortController) {
  if (controller.signal.aborted) return "Task timed out.";
  if (error instanceof InputError) return error.message;
  if (error instanceof Error) return redactSecrets(error.message).slice(0, 500);
  return "Execution failed.";
}

function launch(run: WorkRun, task: WorkTask | undefined, timeoutMs: number, execute: (controller: AbortController) => Promise<void>) {
  const key = taskKey(run.id, task?.id);
  const controller = new AbortController();
  state.active.set(key, controller);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  void execute(controller).catch(() => {
    console.error("[workforce] failed to persist worker state", key);
  }).finally(() => {
    clearTimeout(timeout);
    state.active.delete(key);
  });
}

async function planRun(run: WorkRun, controller: AbortController) {
  try {
    const room = await requireRoom(run.input.roomId);
    const bots = (await listBots()).filter((bot) => room.memberIds.includes(bot.id) && !profileFor(bot).disabled);
    const [tools, skills] = await Promise.all([disabledTools(), disabledSkills()]);
    const result = await createPlan(run, room, bots, tools, skills, controller.signal);
    await serialized(async () => {
      const current = await getRun(run.id);
      if (current?.status !== "planning") return;
      current.tasks = result.tasks;
      current.planningUsage = result.usage;
      current.error = undefined;
      await save(current, [audit(current, "plan_ready", `${current.tasks.length} tasks assigned to room agents.`)]);
    });
  } catch (error) {
    await serialized(async () => {
      const current = await getRun(run.id);
      if (current?.status !== "planning") return;
      current.error = failureMessage(error, controller);
      const retry = current.planningAttempts < maximumAttempts && !(error instanceof InputError);
      if (retry) current.planningRetryAt = new Date(Date.now() + 1000 * 2 ** current.planningAttempts).toISOString();
      else {
        current.status = "failed";
        current.finishedAt = now();
      }
      await save(current, [audit(current, retry ? "planning_retry" : "planning_failed", current.error)]);
    });
  }
}

async function queueFollowUp(run: WorkRun, review: WorkTask, followUp: NonNullable<TaskOutput["followUp"]>) {
  const room = await getRoom(run.input.roomId);
  const available = (await listBots()).filter((bot) => room?.memberIds.includes(bot.id) && bot.id !== review.botId && !profileFor(bot).disabled);
  const peer = available.find((bot) => run.tasks.some((task) => task.kind === "work" && task.botId === bot.id)) ?? available[0];
  const report = run.tasks.find((task) => task.kind === "report");
  if (!peer || !report) return audit(run, "follow_up_for_owner", followUp.instruction, review);
  const task: WorkTask = {
    id: "verification", kind: "verify", title: followUp.kind === "question" ? "Answer a reviewer question"
      : followUp.kind === "delegate" ? "Complete a delegated follow-up" : "Independently verify a finding",
    instruction: followUp.instruction, botId: peer.id, botName: peer.name,
    dependencies: [...review.dependencies, review.id], status: "queued", attempts: 0,
  };
  run.tasks.splice(run.tasks.indexOf(report), 0, task);
  report.dependencies.push(task.id);
  return audit(run, "follow_up_delegated", `${review.botName} → ${peer.name}. ${followUp.instruction}`, task);
}

async function executeTask(run: WorkRun, task: WorkTask, controller: AbortController) {
  try {
    const bot = await getBot(task.botId);
    if (!bot || profileFor(bot).disabled) throw new InputError("Assigned agent is no longer available.");
    let evidence = task.toolOutput;
    if (task.tool && !evidence) {
      const call = task.tool;
      const dispatch = await serialized(async () => {
        const current = await getRun(run.id);
        const result = current?.tasks.find(({ id }) => id === task.id);
        if (!current || result?.status !== "running") return false;
        const owner = await getBot(result.botId);
        if (!owner || profileFor(owner).disabled || !allowedTools(owner, await disabledTools()).includes(call.id)) throw new InputError("Tool permission was removed.");
        if (needsApproval(owner, call.id) && result.approval?.status !== "approved") {
          result.status = "approval";
          result.approval = { status: "pending", at: now() };
          result.attempts--;
          await save(current, [audit(current, "approval_requested", JSON.stringify(call), result)]);
          return false;
        }
        controller.signal.throwIfAborted();
        result.dispatchedAt = now();
        await save(current, [audit(current, "tool_dispatched", `${call.id} (${current.input.mode})`, result)]);
        return true;
      });
      if (!dispatch) return;
      evidence = await executeTool(call, run.input, controller.signal);
      await serialized(async () => {
        const current = await getRun(run.id);
        const result = current?.tasks.find(({ id }) => id === task.id);
        if (!current || !result) return;
        result.toolOutput = evidence;
        await save(current, [audit(current, "tool_finished", `${call.id} (${evidence?.mode})`, result)]);
      });
    }
    const collectSource = run.input.planner === "rules" && task.kind === "work" && task.tool?.id === "web_extract";
    const output = collectSource && evidence ? evidence : await performTask(run, task, bot, evidence, controller.signal);
    await serialized(async () => {
      const current = await getRun(run.id);
      const result = current?.tasks.find(({ id }) => id === task.id);
      if (!current || result?.status !== "running") return;
      result.status = "done";
      result.output = output;
      result.error = undefined;
      result.finishedAt = now();
      const events = [audit(current, "task_completed", result.botName, result)];
      if (result.kind === "review" && output.followUp && !current.tasks.some((item) => item.id === "verification")) {
        events.push(await queueFollowUp(current, result, output.followUp));
      }
      await save(current, events);
    });
  } catch (error) {
    await serialized(async () => {
      const current = await getRun(run.id);
      const result = current?.tasks.find(({ id }) => id === task.id);
      if (!current || result?.status !== "running") return;
      const uncertain = externalWrite(result) && result.dispatchedAt && !result.toolOutput && !(error instanceof InputError);
      const retry = !uncertain && result.attempts < maximumAttempts && !(error instanceof InputError);
      result.error = uncertain ? "External action was dispatched without a receipt. Verify its outcome at the destination before trying again." : failureMessage(error, controller);
      result.status = retry ? "queued" : "failed";
      result.finishedAt = retry ? undefined : now();
      result.retryAt = retry ? new Date(Date.now() + 1000 * 2 ** result.attempts).toISOString() : undefined;
      await save(current, [audit(current, retry ? "task_retry_scheduled" : "task_failed", result.error, result)]);
    });
  }
}

async function tick() {
  const at = now();
  await scheduleReady(at);
  const runs = await workingRuns();
  const models = runs.some((run) => run.input.mode === "live") ? await settings() : undefined;
  for (const run of runs) {
    if (state.active.size >= workers) return;
    const local = run.input.mode === "live" && models && [models.defaultModel, models.fallback].some((id) => id.startsWith("local:"));
    if (run.status === "planning") {
      if (state.active.has(taskKey(run.id)) || (run.planningRetryAt && run.planningRetryAt > at)) continue;
      run.planningAttempts++;
      run.planningRetryAt = undefined;
      await save(run, [audit(run, "planning_started", `Attempt ${run.planningAttempts}.`)]);
      const localPlanner = local || (run.input.mode === "live" && models?.planning.startsWith("local:"));
      launch(run, undefined, localPlanner ? 300_000 : 55_000, (controller) => planRun(run, controller));
      continue;
    }
    for (const task of run.tasks) {
      if (state.active.size >= workers) break;
      if (task.status !== "queued" || (task.retryAt && task.retryAt > at) || state.active.has(taskKey(run.id, task.id))) continue;
      const dependencies = task.dependencies.map((id) => run.tasks.find((item) => item.id === id)!);
      if (!dependencies.every(terminal)) continue;
      if (task.kind === "work" && dependencies.some(({ status }) => status !== "done")) {
        task.status = "skipped";
        task.finishedAt = at;
        task.error = "A required dependency did not complete.";
        await save(run, [audit(run, "task_skipped", task.error, task)]);
        continue;
      }
      task.attempts++;
      task.startedAt = at;
      task.status = "running";
      task.retryAt = undefined;
      await save(run, [audit(run, "task_started", `Attempt ${task.attempts} assigned to ${task.botName}.`, task)]);
      const snapshot = structuredClone(run);
      const assignment = snapshot.tasks.find((item) => item.id === task.id)!;
      launch(snapshot, assignment, local ? 300_000 : 80_000, (controller) => executeTask(snapshot, assignment, controller));
    }
  }
}

async function recover() {
  for (const run of await workingRuns()) {
    const events: AuditEvent[] = [];
    if (run.status === "planning" && run.planningAttempts && !run.planningRetryAt) {
      run.planningAttempts--;
      events.push(audit(run, "planning_recovered", "Planning was interrupted and will restart."));
    }
    for (const task of run.tasks.filter((item) => item.status === "running")) {
      const uncertain = externalWrite(task) && task.dispatchedAt && !task.toolOutput;
      task.status = uncertain ? "failed" : "queued";
      task.error = uncertain ? "Server restarted after external dispatch. Verify the destination before trying again." : "Recovered after server restart.";
      if (uncertain) task.finishedAt = now();
      else task.attempts--;
      events.push(audit(run, uncertain ? "dispatch_unconfirmed" : "task_recovered", task.error, task));
    }
    if (events.length) await save(run, events);
  }
}

export function startEngine() {
  state.boot ??= serialized(recover).then(() => {
    let ticking = false;
    state.timer = setInterval(() => {
      if (ticking) return;
      ticking = true;
      void serialized(tick).catch(() => console.error("[workforce] scheduler tick failed")).finally(() => { ticking = false; });
    }, 500);
    state.timer.unref();
  }).catch((error) => {
    state.boot = undefined;
    throw error;
  });
  return state.boot;
}
