import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@libsql/client";

const root = fileURLToPath(new URL("../", import.meta.url));
const data = join(root, "data", "workforce-checks", randomUUID().slice(0, 10));
mkdirSync(data, { recursive: true });
const port = Number(process.env.WORKFORCE_TEST_PORT || 3189);
const url = `http://127.0.0.1:${port}`;
let child;
let logs = "";
let heldResponse;
let writes = 0;
let sawSourceContext = false;

const fake = createServer(async (req, res) => {
  const parts = [];
  for await (const chunk of req) parts.push(chunk);
  const { model, messages } = JSON.parse(Buffer.concat(parts));
  if (!req.url.endsWith("/chat/completions")) writes++;
  if (model === "unavailable") { res.writeHead(503).end(); return; }
  const payload = JSON.parse(messages[1].content);
  const isPlan = Array.isArray(payload.roster);
  if (payload.kind === "work" && payload.objective.startsWith("Review upstream room routing")) {
    sawSourceContext = payload.handoffs.some(({ output }) => output?.includes("function mentionsIn") && output.includes("queue.push({ bot: next"));
  }
  if (model === "test-slow" && !isPlan && !heldResponse) {
    heldResponse = res;
    return;
  }
  const issueTask = payload.objective?.startsWith("Create a GitHub issue") ? [{
    id: "propose", title: "Create a GitHub issue",
    botId: payload.roster?.find((agent) => agent.tools.includes("github_issue"))?.id ?? "",
    instruction: "Preview the exact proposed write for the local owner's approval.", dependencies: [],
    tool: { id: "github_issue", args: { repo: "Studio1-OSS/OpenCrewBot", title: "Live rejection fixture", body: "Approval only. Never create this issue." } },
  }] : undefined;
  const content = isPlan
    ? JSON.stringify({ tasks: issueTask ?? [
      { id: "one", title: "Prepare first comparison", botId: payload.roster[0].id, instruction: "Workstream one", dependencies: [] },
      { id: "two", title: "Prepare second comparison", botId: payload.roster.at(-1).id, instruction: "Workstream two", dependencies: [] },
    ] })
    : payload.kind === "review" && payload.objective === "Compare two onboarding approaches for a new product."
      ? "The comparison needs an independent check.\nFOLLOW-UP VERIFY: Verify the comparison uses the same criteria for both approaches."
      : "Fixture output for verifying provider routing and process recovery.";
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
    choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20 },
  }));
});
await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));

async function api(path, value, status = 200) {
  const response = await fetch(url + path, {
    signal: AbortSignal.timeout(30_000),
    ...(value ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data).slice(0, 750));
  return data;
}
const workforce = (value, status) => api("/api/workforce", value, status);
const runView = (id) => api(`/api/workforce?id=${id}`);
async function waitFor(read, predicate, timeout = 35_000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await delay(250);
  }
  throw new Error(`Condition timed out. Last response: ${JSON.stringify(value).slice(0, 2400)}`);
}
function start() {
  logs = "";
  child = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, OPENCREWBOT_DATA_DIR: data, WORKFORCE_LOCAL_URL: `http://127.0.0.1:${fake.address().port}/v1` },
  });
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
}
async function ready() {
  return waitFor(async () => {
    if (child.exitCode !== null) throw new Error(logs);
    if (!logs.includes("Ready in")) return null;
    try { return await api("/api/bootstrap"); } catch (error) {
      if (child.exitCode !== null) throw error;
      return null;
    }
  }, (data) => Array.isArray(data?.bots));
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const closed = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await closed;
}

const results = [];
const checked = (name, evidence) => { results.push({ name, evidence }); console.log(`PASS ${name} • ${evidence}`); };
try {
  start();
  const baseline = await ready();
  const page = await fetch(url);
  assert.ok(page.ok);
  assert.match(await page.text(), /OpenCrewBot 2\.0/);
  assert.ok(baseline.bots.length >= 8 && baseline.rooms.length >= 4);
  const { skills, tools } = await api("/api/workforce?view=config");
  assert.equal(skills.length, 8);
  checked("Upstream app and seeded Workforce", `${baseline.bots.length} agents, ${baseline.rooms.length} rooms, ${skills.length} skills, ${Object.keys(tools).length} tools`);

  const operations = baseline.rooms.find((room) => room.name === "Business Operations");
  const engineering = baseline.rooms.find((room) => room.name === "Engineering");
  const studio = baseline.rooms.find((room) => room.name === "Studio");
  const market = baseline.rooms.find((room) => room.name === "Market Intelligence");
  const base = { action: "start", roomId: operations.id, project: "meetuniversity", mode: "mock", sequential: false };
  const awaitStatus = (id, statuses) => waitFor(() => runView(id), ({ run }) => statuses.includes(run.status));

  const { bot } = await workforce({ action: "agent", description: "Create an agent named Cedar for reviewing sales funnels and monitoring data analysis.", mode: "mock", roomId: operations.id });
  assert.equal(bot.name, "Cedar");
  const roster = await api("/api/bootstrap");
  assert.ok(roster.rooms.find(({ id }) => id === operations.id).memberIds.includes(bot.id));
  checked("Natural-language agent factory", "Cedar persisted and became a room member immediately");

  const csv = readFileSync(join(root, "examples", "meetuniversity-sales.csv"), "utf8");
  const analysis = await workforce({ ...base, instruction: "Analyze the sales spreadsheet and find conversion bottlenecks by channel.", csv: { name: "sample.csv", text: csv } });
  const report = await awaitStatus(analysis.id, ["completed", "failed"]);
  assert.equal(report.run.status, "completed");
  const calculation = report.run.tasks.find((task) => task.tool?.id === "csv");
  assert.equal(calculation.toolOutput.mode, "LOCAL");
  assert.equal(calculation.toolOutput.chart[0].value, 700);
  assert.match(calculation.toolOutput.markdown, /1,080,000/);
  assert.equal(report.run.tasks.find((task) => task.id === "report").output.mode, "SIMULATED");
  checked("Actual CSV calculations", "700 leads, 1,080,000 total revenue, local funnel chart and labelled simulated narrative");

  const objective = "Create a GitHub issue in https://github.com/Studio1-OSS/OpenCrewBot titled \"Verification only\". Body: This test must never dispatch.";
  const action = await workforce({ ...base, roomId: engineering.id, instruction: objective });
  const pending = await awaitStatus(action.id, ["waiting"]);
  const approval = pending.run.tasks.find((task) => task.status === "approval");
  assert.equal(approval.tool.args.title, "Verification only");
  assert.equal(approval.approval.status, "pending");
  const dashboard = await api("/api/workforce?view=approvals");
  assert.ok(dashboard.approvals.some((entry) => entry.runId === action.id));
  assert.equal(pending.audit.some((event) => event.event === "tool_dispatched"), false);
  await workforce({ action: "approval", id: action.id, taskId: approval.id, approve: false });
  await workforce({ action: "approval", id: action.id, taskId: approval.id, approve: true }, 400);
  const denied = await awaitStatus(action.id, ["completed"]);
  assert.ok(denied.audit.some((event) => event.event === "approval_rejected"));
  assert.equal(denied.audit.some((event) => event.event === "tool_dispatched"), false);
  checked("Approval rejection and replay protection", `Run ${action.id}, zero dispatch events, second decision refused`);

  const auditDb = createClient({ url: `file:${join(data, "opencrewbot.db")}` });
  await assert.rejects(() => auditDb.execute("DELETE FROM workforce_audit"), /Append-only audit/);
  auditDb.close();
  checked("Audit immutability", "SQLite refused an attempt to delete journal rows");

  const flow = await workforce({ ...base, action: "create-schedule", roomId: market.id, name: "Competitor watch", intervalMinutes: 1,
    instruction: "Check competitor pricing changes and summarize source gaps." });
  const manual = await workforce({ action: "change-schedule", id: flow.schedule.id, command: "run" });
  const scheduledApprovals = await awaitStatus(manual.id, ["waiting"]);
  for (const task of scheduledApprovals.run.tasks.filter(({ status }) => status === "approval")) {
    await workforce({ action: "approval", id: manual.id, taskId: task.id, approve: true });
  }
  await awaitStatus(manual.id, ["completed"]);
  await workforce({ action: "change-schedule", id: flow.schedule.id, command: "pause" });
  const paused = await api("/api/workforce?view=config");
  assert.equal(paused.schedules.find(({ id }) => id === flow.schedule.id).paused, true);
  await workforce({ action: "change-schedule", id: flow.schedule.id, command: "resume" });
  checked("Schedule and history controls", "Created recurring workflow, ran manually, produced report, paused and resumed");

  const controlled = baseline.bots.filter((entry) => market.memberIds.includes(entry.id) && entry.workforce?.allowedTools.includes("web_search"));
  for (const agent of controlled) {
    await workforce({ action: "agent-profile", id: agent.id, ...agent.workforce, approval: "controlled", model: "", disabled: false, preapproved: ["web_search"] });
  }
  const controlledRead = await workforce({ ...base, roomId: market.id, instruction: "Research competitor pricing and evaluate positioning." });
  const controlledRun = await awaitStatus(controlledRead.id, ["completed"]);
  assert.ok(controlledRun.audit.some((event) => event.event === "tool_dispatched" && event.detail === "web_search (mock)"));
  assert.equal(controlledRun.audit.some((event) => event.event === "approval_requested"), false);
  const forge = baseline.bots.find(({ handle }) => handle === "forge");
  await workforce({ action: "agent-profile", id: forge.id, ...forge.workforce, approval: "full", model: "", disabled: false });
  checked("Controlled Access policy", "An allowlisted pre-approved read ran without pausing in mock mode");

  const memory = await workforce({ action: "memory", scope: "preferences", id: "", markdown: "Use a terse numbered checklist." });
  await workforce({ action: "memory", scope: "agent", id: bot.id, markdown: "Cedar prefers grouping the funnel by region." });
  assert.match(memory.provenance, /Edited by the local owner/);
  const model = (planning, defaultModel, fallback = "") => workforce({ action: "providers", planning, defaultModel, fallback, maxOutputTokens: 2000 });
  await model("local:unavailable", "local:unavailable", "local:test-fallback");
  const live = await workforce({ ...base, roomId: studio.id, mode: "live", instruction: "Compare two onboarding approaches for a new product." });
  const routed = await awaitStatus(live.id, ["completed", "failed"]);
  assert.equal(routed.run.status, "completed");
  const [one, two] = routed.run.tasks;
  assert.ok(Date.parse(one.startedAt) <= Date.parse(two.finishedAt) && Date.parse(two.startedAt) <= Date.parse(one.finishedAt));
  assert.equal(routed.run.planningUsage.model, "local:test-fallback");
  assert.ok(routed.audit.some((event) => event.event === "plan_ready"));
  checked("Provider fallback, DAG and parallel execution", "Intentional HTTP 503 switched to fixture fallback, two workstreams overlapped, review and report completed");
  assert.equal(routed.run.tasks.filter((task) => task.kind === "verify").length, 1);
  assert.ok(routed.run.tasks.find((task) => task.id === "report").dependencies.includes("verification"));
  assert.ok(routed.audit.some((event) => event.event === "follow_up_delegated"));
  checked("Bounded peer verification", "A reviewer dispatched one verification task to a peer before final synthesis");

  const liveWrite = await workforce({ ...base, roomId: engineering.id, mode: "live", instruction: objective });
  const livePending = await awaitStatus(liveWrite.id, ["waiting"]);
  const liveTask = livePending.run.tasks.find((task) => task.status === "approval");
  assert.equal(liveTask.tool.args.title, "Live rejection fixture");
  await workforce({ action: "approval", id: liveWrite.id, taskId: liveTask.id, approve: false });
  const liveDenied = await awaitStatus(liveWrite.id, ["completed"]);
  assert.equal(liveDenied.audit.some((event) => event.event === "tool_dispatched"), false);
  checked("Rejection of a live-mode write proposal", "Full Access still required approval for the GitHub write, and rejection prevented dispatch. The plan came from a local fixture.");

  await model("local:unavailable", "local:unavailable");
  const failure = await workforce({ ...base, mode: "live", instruction: "Use the fixture to test planner retries." });
  const failed = await awaitStatus(failure.id, ["failed"]);
  assert.equal(failed.run.planningAttempts, 3);
  assert.equal(failed.audit.filter((event) => event.event === "planning_retry").length, 2);
  await model("local:test-fast", "local:test-fast");
  await workforce({ action: "change-run", id: failure.id, command: "retry" });
  await awaitStatus(failure.id, ["completed"]);
  checked("Bounded retry and failed-run recovery", "Two backoffs, persisted failure, safe manual retry resumed to completion");

  await model("local:test-fast", "local:test-slow");
  const interruption = await workforce({ ...base, mode: "live", roomId: studio.id, instruction: "Compare staffing options and hold one fixture response." });
  await waitFor(async () => heldResponse, Boolean);
  const interrupted = await awaitStatus(interruption.id, ["running"]);
  assert.ok(interrupted.run.tasks.some((task) => task.status === "running"));
  await stop();
  heldResponse.destroy();
  start();
  await ready();
  const recovered = await awaitStatus(interruption.id, ["completed", "failed"]);
  assert.equal(recovered.run.status, "completed");
  assert.ok(recovered.audit.some((entry) => entry.event === "task_recovered"));
  checked("Process restart recovery", "Killed a process mid-task, restarted on the same SQLite database, requeued execution and completed report");

  const saved = await api("/api/workforce?scope=preferences");
  assert.match(saved.markdown, /terse numbered checklist/);
  const agentMemory = await api(`/api/workforce?scope=agent&owner=${bot.id}`);
  assert.match(agentMemory.markdown, /grouping the funnel by region/);
  const recall = await workforce({ ...base, instruction: "Recall the user's output preferences." });
  const original = await awaitStatus(recall.id, ["completed"]);
  assert.match(original.run.tasks.at(-1).output.markdown, /terse numbered checklist/);
  writeFileSync(memory.path, "Use a one-paragraph executive summary.", "utf8");
  const amended = await workforce({ action: "change-run", id: recall.id, command: "amend", instruction: "Apply the corrected preference." });
  const amendedRun = await awaitStatus(amended.id, ["completed"]);
  assert.equal(amendedRun.run.parentId, recall.id);
  assert.match(amendedRun.run.tasks.at(-1).output.markdown, /one-paragraph executive summary/);
  assert.equal(writes, 0);
  checked("Editable memory and amended plan", "Preference survived restart, direct Markdown correction appeared in next run, and successor linked to original");

  if (process.env.WORKFORCE_TEST_PUBLIC === "1") {
    for (const id of ["github", "deepwiki", "learn", "public-web"]) {
      const result = await workforce({ action: "integration-test", id });
      assert.equal(result.output.mode, "LIVE");
      checked(`Live ${id} integration`, result.output.markdown.split("\n")[0]);
    }
    const connected = await api("/api/bootstrap");
    for (const agent of connected.bots.filter((bot) => engineering.memberIds.includes(bot.id))) {
      await workforce({ ...agent.workforce, action: "agent-profile", id: agent.id, approval: "controlled", model: "", disabled: false, preapproved: ["github_read"] });
    }
    const { id } = await workforce({ ...base, roomId: engineering.id, mode: "live", planner: "rules",
      instruction: "Review upstream room routing at https://github.com/Studio1-OSS/OpenCrewBot/blob/main/src/lib/server/rooms.ts and propose improvements.",
    });
    const sourceRun = await awaitStatus(id, ["completed", "failed"]);
    assert.equal(sourceRun.run.status, "completed");
    assert.ok(sawSourceContext, "The reviewer received defining statements and their later uses.");
    checked("GitHub source file handoff", "A live TypeScript source read reached the review worker with both the definition and later call-site context.");
  }
  if (process.env.WORKFORCE_TEST_SCHEDULE === "1") {
    const due = await waitFor(() => api("/api/workforce"), ({ runs }) => runs.some((run) => run.scheduleId === flow.schedule.id && run.id !== manual.id), 68_000);
    const scheduled = due.runs.find((run) => run.scheduleId === flow.schedule.id && run.id !== manual.id);
    const emitted = await runView(scheduled.id);
    assert.ok(emitted.audit.some((event) => event.detail.includes("Scheduled for")));
    await workforce({ action: "change-schedule", id: flow.schedule.id, command: "pause" });
    checked("Timer-triggered schedule", "A distinct scheduled run was created automatically after the next due time");
  }
  writeFileSync(join(data, "results.json"), JSON.stringify({ date: new Date().toISOString(), platform: process.platform, node: process.version, checks: results }, null, 2));
  console.log(`Evidence: ${join(data, "results.json")}`);
} catch (error) {
  console.error(error, logs.slice(-4500));
  process.exitCode = 1;
} finally {
  await stop();
  fake.closeAllConnections();
  await new Promise((resolve) => fake.close(resolve));
}
