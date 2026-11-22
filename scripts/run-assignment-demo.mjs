import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "data", "assignment-demo", randomUUID().slice(0, 8));
const port = Number(process.env.WORKFORCE_DEMO_PORT || 3196);
const origin = `http://127.0.0.1:${port}`;
const model = process.env.WORKFORCE_DEMO_MODEL || "local:qwen3-1.7b";
const localURL = process.env.WORKFORCE_LOCAL_URL || "http://127.0.0.1:11435/v1";
const only = new Set(process.argv.slice(2));
const results = [];
let server;

assert.match(model, /^local:/);
assert.match(localURL, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/v1\/?$/);
mkdirSync(output, { recursive: true });
console.log(`Evidence directory ${output}`);

async function api(path, payload) {
  const response = await fetch(`${origin}${path}`, payload ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  } : undefined);
  const data = await response.json();
  assert.ok(response.ok, `${path} HTTP ${response.status} ${data.error || ""}`);
  return data;
}

const post = (payload) => api("/api/workforce", payload);
const view = (id) => api(`/api/workforce?id=${id}`);
const read = (params = "") => api(`/api/workforce${params}`);

async function waitFor(readValue, matches, timeout = 540_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await readValue();
    if (matches(value)) return value;
    await delay(800);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for application state.");
}

async function start() {
  server = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env, OPENCREWBOT_DATA_DIR: join(output, "app"), WORKFORCE_LOCAL_URL: localURL,
      OPENCREWBOT_LOCAL_CHAT_MODEL: model.slice(6), OPENCREWBOT_CHAT_DEFAULT_MODEL: model,
      WORKFORCE_MODEL: model, WORKFORCE_PLAN_MODEL: model, WORKFORCE_FALLBACK_MODEL: "",
      NEBIUS_API_KEY: "", OPENAI_API_KEY: "", TAVILY_API_KEY: "", WORKFORCE_GITHUB_TOKEN: "", WORKFORCE_SLACK_TOKEN: "",
    },
  });
  return waitFor(async () => {
    if (server.exitCode !== null) throw new Error(`Demo server exited with code ${server.exitCode}.`);
    return api("/api/bootstrap").catch(() => null);
  }, Boolean, 20_000);
}

async function stop() {
  if (!server || server.exitCode !== null || server.signalCode) return;
  const exit = new Promise((resolve) => server.once("exit", resolve));
  server.kill();
  await exit;
}

const persist = () => writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
const done = (id) => waitFor(() => view(id), ({ run }) => ["completed", "failed", "waiting"].includes(run.status));

function saveRun(label, evidence) {
  writeFileSync(join(output, `${label}.json`), JSON.stringify(evidence, null, 2));
  const tasks = evidence.run.tasks;
  const report = tasks.find(({ kind }) => kind === "report")?.output?.markdown;
  if (report) writeFileSync(join(output, `${label}.md`), report);
  const gaps = tasks.filter((task) => task.status !== "done").map((task) => `${task.title}: ${task.error ?? task.status}`);
  if (gaps.length) console.log(label, gaps.join("; "));
  return tasks;
}

function liveWorker(tasks) {
  assert.ok(tasks.some((task) => task.kind === "work" && task.output?.usage?.model === model), "A local model worker must supply a deliverable.");
  assert.equal(tasks.find(({ kind }) => kind === "report")?.status, "done");
}

async function scenario(label, run) {
  if (only.size && !only.has(label)) return;
  const result = { scenario: label };
  try {
    Object.assign(result, await run(), { passed: true });
  } catch (error) {
    Object.assign(result, { passed: false, error: error.message });
    process.exitCode = 1;
  }
  results.push(result);
  persist();
  console.log(JSON.stringify(result));
}

const marketSources = [
  "https://www.idp.com/india/what-we-do/free-study-abroad-counselling/",
  "https://yocket.com/premium",
  "https://www.mindler.com/pricing",
];

try {
  const roster = await start();
  const roomId = (name) => {
    const room = roster.rooms.find((entry) => entry.name === name);
    assert.ok(room, `Missing seed room ${name}`);
    return room.id;
  };
  const setup = async (maxOutputTokens) => post({ action: "providers", planning: model, defaultModel: model, fallback: "", maxOutputTokens });
  await setup(1550);
  const permitted = new Set(["web_extract", "github_read", "deepwiki", "learn_docs", "csv"]);
  for (const bot of roster.bots) {
    await post({
      ...bot.workforce, action: "agent-profile", id: bot.id, approval: "controlled", model, disabled: false,
      preapproved: bot.workforce.allowedTools.filter((id) => permitted.has(id)),
    });
  }
  const input = (room, project, instruction, extra = {}) => ({ roomId: roomId(room), project, instruction, mode: "live", planner: "rules", sequential: false, ...extra });
  const launch = (room, project, instruction, extra) => post({ action: "start", ...input(room, project, instruction, extra) });
  const finish = async (label, id) => {
    const evidence = await done(id);
    const tasks = saveRun(label, evidence);
    assert.equal(evidence.run.status, "completed");
    return tasks;
  };

  let scheduledRun;
  if (!only.size || only.has("schedule")) {
    const { schedule } = await post({ action: "create-schedule", name: "Yocket pricing monitor", intervalMinutes: 1,
      ...input("Market Intelligence", "competitor-monitor", `Check Yocket's public offers at ${marketSources[1]} and record the retrieval date, prices actually seen, and one question for the next digest. Keep it under 150 words.`),
    });
    scheduledRun = waitFor(() => read("?q=competitor-monitor"), ({ runs }) => runs.some((run) => run.scheduleId === schedule.id), 110_000)
      .then(async ({ runs }) => {
        await post({ action: "change-schedule", id: schedule.id, command: "pause" });
        return { id: runs.find((run) => run.scheduleId === schedule.id).id, scheduleId: schedule.id };
      })
      .catch((error) => ({ error }));
  }

  await scenario("market", async () => {
    const { id } = await launch("Market Intelligence", "meetuniversity-market", `Research MeetUniversity's Indian student-advisory competitors using these first-party pages: ${marketSources.join(" ")}. Compare at least three actual competitors in a Markdown table with offering, disclosed pricing, target customer, positioning and source. Label price unknown when absent. Propose three practical positioning opportunities for MeetUniversity as hypotheses. Keep it under 550 words.`);
    const tasks = await finish("market", id);
    liveWorker(tasks);
    assert.equal(tasks.filter((task) => task.tool?.id === "web_extract" && task.toolOutput?.mode === "LIVE").length, 3);
    return { id, liveSources: 3 };
  });

  await scenario("campaign", async () => {
    const { id } = await launch("Studio", "class-11-campaign", "Develop MeetUniversity Aspirations' Class 11 campaign for Indian students and their parents. Source audience needs using https://cbseacademic.nic.in/skill-education-curriculum.html and https://asercentre.org/aser-2023-beyond-basics/. Give two positioning strategies and two concepts. Include a Markdown content calendar with one short row per day (days 1 through 30), channel, theme and CTA. Provide draft Instagram carousel wording and a draft parent email. Keep calendar rows short and cite the supplied audience sources without inventing statistics.");
    const tasks = await finish("campaign", id);
    liveWorker(tasks);
    const campaign = tasks.find((task) => task.kind === "work" && task.output?.usage)?.output.markdown;
    assert.ok(campaign?.match(/(?:^|\n)\s*\|?\s*(?:Day\s*)?30[\s.|:–-]/i), "The local draft must reach day 30.");
    return { id, includesDay30: true };
  });

  await setup(550);

  await scenario("sales", async () => {
    const csv = { name: "meetuniversity-sales.csv", text: readFileSync(join(root, "examples", "meetuniversity-sales.csv"), "utf8") };
    const { id } = await launch("Business Operations", "meetuniversity-sales", "Analyze the attached sales CSV and compare the conversion funnel by channel. Quote exact stage counts, sales and recorded revenue. Identify the biggest drop-off, channel differences and two specific experiments. Keep it under 300 words.", { csv });
    const tasks = await finish("sales", id);
    liveWorker(tasks);
    const calculation = tasks.find((task) => task.tool?.id === "csv")?.toolOutput;
    assert.equal(calculation?.mode, "LOCAL");
    assert.match(calculation.markdown, /1,080,000/);
    return { id, mode: calculation.mode };
  });

  await scenario("engineering", async () => {
    const repo = "https://github.com/Studio1-OSS/OpenCrewBot";
    const { id } = await launch("Engineering", "opencrewbot-review", `Review actual upstream TypeScript at ${repo}/blob/main/src/lib/server/rooms.ts for maintainability and test coverage. Then prepare a prioritized development plan with evidence, proposed changes and acceptance checks. Use read-only access.`);
    const tasks = await finish("engineering", id);
    liveWorker(tasks);
    assert.ok(tasks.some((task) => task.tool?.args.path === "src/lib/server/rooms.ts" && task.toolOutput?.mode === "LIVE"));
    return { id, reviewedFile: "src/lib/server/rooms.ts" };
  });

  await scenario("schedule", async () => {
    const { id, scheduleId, error } = await scheduledRun;
    if (error) throw error;
    const tasks = await finish("schedule", id);
    liveWorker(tasks);
    const evidence = await view(id);
    assert.ok(evidence.audit.some((event) => event.event === "run_created" && event.detail.includes("Scheduled for")));
    return { id, scheduleId, automatic: true };
  });

  await scenario("memory", async () => {
    const first = "Use a numbered action checklist for reports.";
    const correction = "Use a one-paragraph executive summary for reports.";
    const file = await post({ action: "memory", scope: "preferences", id: "", markdown: first });
    await stop();
    await start();
    assert.match((await read("?scope=preferences")).markdown, /numbered action checklist/i);
    const recall = async (label, expected) => {
      const { id } = await launch("Business Operations", label, "Read the stored report-format preference and repeat the preference sentence verbatim. Output just that sentence.");
      const tasks = await finish(label, id);
      liveWorker(tasks);
      assert.match(tasks.find((task) => task.kind === "work").output.markdown, expected);
      return id;
    };
    const restartId = await recall("memory-restart", /numbered action checklist/i);
    writeFileSync(file.path, correction);
    const editedId = await recall("memory-edit", /one.paragraph executive summary/i);
    return { restartId, editedId };
  });

  await scenario("approval", async () => {
    const { id } = await launch("Engineering", "reject-external-write", 'Create a GitHub issue in https://github.com/Studio1-OSS/OpenCrewBot titled "Approval boundary test". Body: This exact request is for the rejection walkthrough.');
    const pending = await done(id);
    assert.equal(pending.run.status, "waiting");
    saveRun("approval-pending", pending);
    const task = pending.run.tasks.find((entry) => entry.status === "approval");
    assert.equal(task?.tool?.id, "github_issue");
    await post({ action: "approval", id, taskId: task.id, approve: false });
    const tasks = await finish("approval", id);
    const evidence = await view(id);
    assert.equal(tasks.find((entry) => entry.id === task.id).status, "rejected");
    assert.ok(evidence.audit.some((entry) => entry.event === "approval_rejected"));
    assert.equal(evidence.audit.filter((entry) => entry.event === "tool_dispatched").length, 0);
    return { id, dispatched: 0 };
  });
} finally {
  await stop();
}
