import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = join(root, "data", "workforce-recording", randomUUID().slice(0, 8));
mkdirSync(base, { recursive: true });
const port = Number(process.env.WORKFORCE_VIDEO_PORT || 3191);
const url = `http://127.0.0.1:${port}`;
const evidenceDirectory = process.env.WORKFORCE_RECORD_EVIDENCE;
const browserPackage = process.env.WORKFORCE_PLAYWRIGHT_PACKAGE;
const { chromium } = await import(browserPackage ? pathToFileURL(browserPackage).href : "playwright");
let server;
let logs = "";
async function start() {
  server = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, OPENCREWBOT_DATA_DIR: evidenceDirectory ? resolve(evidenceDirectory, "app") : join(base, "app") },
  });
  server.stdout.on("data", (chunk) => { logs += chunk; });
  server.stderr.on("data", (chunk) => { logs += chunk; });
  let ready = false;
  server.stdout.on("data", () => { ready = logs.includes("Ready in"); });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    if (ready) {
      try {
        const response = await fetch(`${url}/api/bootstrap`);
        if (response.ok) return;
      } catch { /* The server may still be starting. */ }
    }
    await delay(200);
  }
  throw new Error("The local server did not start.");
}
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode) return;
  const exit = new Promise((resolve) => server.once("exit", resolve));
  server.kill();
  await exit;
}
const browser = await chromium.launch({
  ...(process.env.WORKFORCE_BROWSER_EXECUTABLE ? { executablePath: process.env.WORKFORCE_BROWSER_EXECUTABLE } : {}),
  headless: true, slowMo: 180,
});
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, recordVideo: { dir: base, size: { width: 1360, height: 900 } } });
const page = await context.newPage();
const video = page.video();
const narration = Number(process.env.WORKFORCE_DEMO_PACE || 1);
const segment = process.env.WORKFORCE_DEMO_SEGMENT || "all";
let success = false;

async function caption(title, text, seconds = 10) {
  console.log(title, text);
  await page.evaluate(({ title, text }) => {
    document.getElementById("demo-caption")?.remove();
    const element = document.createElement("aside");
    element.id = "demo-caption";
    element.style.cssText = "pointer-events:none;position:fixed;z-index:2147483647;right:24px;bottom:20px;width:min(560px,90vw);padding:15px 18px;border:1px solid #486888;border-radius:14px;background:#111b29f5;color:#e5edf5;box-shadow:0 7px 25px #0008;font:15px/1.45 system-ui";
    const header = document.createElement("strong");
    header.style.cssText = "display:block;color:#a4c4ff;margin-bottom:4px";
    header.textContent = title;
    element.append(header, document.createTextNode(text));
    document.body.append(element);
  }, { title, text });
  await delay(seconds * 1000 * narration);
}
const button = (name) => page.getByRole("button", { name, exact: true });
const tab = (name) => page.getByRole("navigation", { name: "Workforce sections" }).getByRole("button", { name, exact: true }).click();
const detail = () => page.getByLabel("Run detail", { exact: true });
const selectRoom = (room) => page.locator("select").filter({ has: page.getByRole("option", { name: room, exact: true }) }).selectOption({ label: room });
const section = (label) => page.locator("section").filter({ has: page.getByRole("heading", { name: label, exact: true }) }).last();
async function openApp() {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      break;
    } catch (error) {
      if (attempt === 2 || !/ERR_NETWORK_IO_SUSPENDED|ERR_CONNECTION_RESET/.test(String(error))) throw error;
      await delay(1200);
    }
  }
  await button("Workforce").click();
  await page.getByRole("heading", { name: "Give your team a task" }).waitFor();
}
async function run(room, instruction, project, csv = false) {
  await tab("Runs");
  await selectRoom(room);
  await page.getByLabel(/^Project/).fill(project);
  await page.getByLabel("Instruction", { exact: true }).fill(instruction);
  if (csv) await page.getByLabel(/^Spreadsheet/).setInputFiles(join(root, "examples", "meetuniversity-sales.csv"));
  await caption(project, "The room and instruction determine what the Chief of Staff delegates. This recording uses offline model output.", 8);
  await button("Start run").click();
  await detail().getByRole("heading", { name: project, exact: true }).waitFor();
}
async function approvals(shouldApprove = true) {
  const label = shouldApprove ? "Approve once" : "Reject";
  await page.getByRole("button", { name: label, exact: true }).first().waitFor();
  while (await page.getByRole("button", { name: label, exact: true }).count()) {
    const shown = await page.getByRole("button", { name: label, exact: true }).count();
    await page.getByRole("button", { name: label, exact: true }).first().click();
    await page.waitForFunction(({ label, shown }) => [...document.querySelectorAll("button")].filter((node) => node.textContent.trim() === label).length < shown, { label, shown });
  }
}
async function finalReport() {
  await page.getByRole("heading", { name: "Final deliverable", exact: true }).waitFor();
}
async function recordEvidence() {
  const cases = [
    ["meetuniversity-market", "Market intelligence", "The agents retrieved first-party webpages. The report combines the local model draft, review, and links to the captured sources."],
    ["class-11-campaign", "Class 11 campaign", "The draft uses public audience references. Check the workstream for campaign concepts, a content calendar and sample copy."],
    ["meetuniversity-sales", "Sales funnel", "The original spreadsheet calculation includes a chart, per-channel totals, and a separate local-model interpretation."],
    ["opencrewbot-review", "Development team", "This run retrieved an actual upstream source file from GitHub. The repository also includes a hand-checked development plan for this target."],
    ["competitor-monitor", "Automatic run", "The audit identifies the timer slot that created this digest."],
    ["memory-title-edit", "Editable memory", "The model recalled WILLOW-23 after restart. Editing the Markdown file changed the reported heading to MAPLE-47."],
    ["reject-external-write", "Rejected external write", "The audit records the rejection. It contains no tool-dispatch event."],
  ];
  await caption("Live assignment evidence", "These runs use a local Qwen model, public read-only sources, and isolated workspace data.", 9);
  for (const [project, title, description] of cases) {
    const search = page.getByRole("searchbox", { name: "Search run history" });
    await search.fill(project);
    const entry = page.getByRole("button", { name: new RegExp(`^${project}\\s`) }).first();
    await entry.waitFor();
    await entry.click();
    await detail().getByRole("heading", { name: project, exact: true }).waitFor();
    if (["competitor-monitor", "reject-external-write"].includes(project)) {
      await detail().locator("summary").filter({ hasText: "Audit log" }).click();
      await detail().getByText(project === "competitor-monitor" ? /Scheduled for / : /^approval rejected$/).first().scrollIntoViewIfNeeded();
    } else if (project === "opencrewbot-review") {
      const inspection = detail().locator("details").filter({ hasText: "Inspect the linked source file" }).first();
      await inspection.locator("summary").click();
      await inspection.getByText("LIVE", { exact: true }).first().scrollIntoViewIfNeeded();
    } else if (project === "meetuniversity-sales") {
      const calculation = detail().locator("details").filter({ hasText: "Calculate spreadsheet metrics" }).first();
      await calculation.locator("summary").click();
      await page.getByLabel("Calculated values by metric", { exact: true }).scrollIntoViewIfNeeded();
    } else {
      await finalReport();
      await section("Final deliverable").scrollIntoViewIfNeeded();
    }
    await caption(title, description, 9);
  }
}
async function recordRehearsal() {
  if (segment === "all") {
    await caption("OpenCrewBot 2.0", "Local walkthrough using MeetUniversity scenarios. Model and research results are simulated. The task engine, CSV math, and approvals shown are real local execution.", 16);

    await tab("Agents");
    await page.getByLabel("Describe the role").fill("Create an agent named Cedar for audience research, campaign planning and data analysis.");
    await page.getByLabel("Add to room").selectOption({ label: "Studio" });
    await button("Create agent").click();
    await page.getByRole("heading", { name: "Cedar", exact: true }).waitFor();
    await caption("Agent factory", "Cedar is added to the Studio room immediately. The profile has skills, tool permissions, a model override, and a Markdown memory file.", 13);

    await run("Market Intelligence", "Research competitors for MeetUniversity. Compare their offerings, public prices, audiences and positioning, then recommend what evidence to collect next.", "market-intelligence");
    await page.getByRole("heading", { name: "Execution plan" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Approve once", exact: true }).first().waitFor();
    await caption("1 • Market intelligence", "Independent evidence tasks are delegated in parallel. Ask First shows the exact search queries. This offline run will return simulated source gaps.", 14);
    await approvals();
    await finalReport();
    await section("Final deliverable").scrollIntoViewIfNeeded();
    await caption("Consolidated report", "Workers hand results to a separate reviewer, then the Chief of Staff consolidates them. Live market evidence requires Tavily and a configured model.", 12);

    await run("Studio", "Draft a campaign for MeetUniversity Aspirations targeting Class 11 students. Develop campaign concepts; prepare a day-by-day 30-day content calendar; write two sample creative assets.", "campaign");
    await finalReport();
    await section("Final deliverable").scrollIntoViewIfNeeded();
    await caption("2 • Class 11 campaign", "The workflow turns the brief into campaign, calendar and asset assignments. This offline output is a planning rehearsal. A live model is required for finished creative work.", 17);

    await run("Business Operations", "Analyze the sales spreadsheet. Identify conversion bottlenecks and compare channels. Recommend the first two experiments.", "sales-funnel", true);
    await finalReport();
    const calculation = detail().locator("details").filter({ hasText: "Calculate spreadsheet metrics" }).first();
    await calculation.locator("summary").click();
    await page.getByLabel("Calculated values by metric", { exact: true }).scrollIntoViewIfNeeded();
    await caption("3 • Actual spreadsheet analysis", "The chart and totals come from the uploaded sample CSV. The four channels contributed 700 leads and ₹1,080,000 in recorded revenue.", 18);

  }
  if (segment !== "closing") {
    await run("Engineering", "Inspect https://github.com/Studio1-OSS/OpenCrewBot for reliability and maintainability. Prepare a prioritized development plan and an acceptance checklist.", "engineering-review");
    await page.getByRole("button", { name: "Approve once", exact: true }).first().waitFor();
    await detail().getByText("Inspect the repository", { exact: true }).first().scrollIntoViewIfNeeded();
    await caption("4 • Development team", "Repository inspection and documentation checks are separate, read-only steps. This offline run shows the plan and simulated tool calls.", 12);
    await approvals();
    await finalReport();

    await tab("Schedules");
    await page.getByLabel("Workflow name").fill("Competitor pricing digest");
    await selectRoom("Market Intelligence");
    await page.getByLabel("Instruction", { exact: true }).fill("Check competitor pricing and summarize changes or evidence gaps.");
    await page.getByLabel(/^Project/).fill("competitor-watch");
    await button("Create schedule").click();
    await button("Run now").waitFor();
    await caption("5 • Autonomous routine", "This competitor-monitoring workflow repeats every 1,440 minutes. Its next execution and pause controls are visible here.", 12);
    await button("Run now").click();
    await approvals();
    await finalReport();
    await tab("Schedules");
    await page.getByText("Competitor pricing digest", { exact: true }).scrollIntoViewIfNeeded();
    await caption("Workflow history", "The manual run appears in the same history as timer-triggered work. Its report and audit remain available.", 10);

  }
  if (segment !== "middle") {
    await tab("Memory");
    const preferences = page.locator("select").filter({ has: page.getByRole("option", { name: "Preferences", exact: true }) });
    await preferences.selectOption("preferences");
    const editor = page.getByLabel("Editable Markdown");
    for (let attempt = 0; attempt < 3; attempt++) {
      await button("Load from disk").click();
      if (await editor.waitFor({ timeout: 4500 }).then(() => true, () => false)) break;
      if (attempt === 1) {
        await stop();
        await start();
        await openApp();
        await tab("Memory");
        await preferences.selectOption("preferences");
      }
    }
    await editor.fill("Use a numbered action list for business reports.");
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/workforce") && response.request().method() === "POST");
    await button("Save memory").click();
    const file = await (await saved).json();
    assert.ok(file.path);
    await caption("6 • Editable memory", "Preferences are written to a Markdown file with a provenance record. The application will now restart using the same storage directory.", 12);
    await stop();
    await start();
    await openApp();
    await run("Business Operations", "Recall the report format preference.", "memory-recall");
    await finalReport();
    await detail().getByText(/Use a numbered action list/).last().scrollIntoViewIfNeeded();
    await caption("Memory persisted", "The next run reads the saved preference after restart. The file can also be edited directly on disk.", 10);
    writeFileSync(file.path, "Use a one-paragraph executive summary.", "utf8");
    await run("Business Operations", "Recall the corrected report format preference.", "memory-correction");
    await finalReport();
    await detail().getByText(/Use a one-paragraph executive summary/).last().scrollIntoViewIfNeeded();
    await caption("Correction applied", "After a direct Markdown edit, the next task reads the corrected preference from disk.", 10);

    await run("Engineering", "Create a GitHub issue in https://github.com/Studio1-OSS/OpenCrewBot titled \"Verification only\". Body: This is an approval rejection exercise.", "human-approval");
    await tab("Approvals");
    await button("Reject").waitFor();
    await caption("7 • Human intervention", "The approval centre shows the exact target, title and body. The action remains unexecuted while approval is pending.", 14);
    await approvals(false);
    await tab("Runs");
    await finalReport();
    await detail().getByText(/tool was never dispatched/).first().scrollIntoViewIfNeeded();
    await detail().locator("summary").filter({ hasText: "Audit log" }).click();
    await detail().getByText("approval rejected", { exact: true }).scrollIntoViewIfNeeded();
    await caption("Rejection evidence", "The audit records the rejection. There is no tool-dispatch event and no external issue was created.", 17);
    if (process.env.WORKFORCE_RECORD_PUBLIC === "1") {
      await tab("Integrations");
      for (const name of ["GitHub", "DeepWiki MCP", "Microsoft Learn MCP"]) {
        const integration = section(name);
        await integration.getByRole("button", { name: "Test live connection" }).click();
        await integration.getByText("LIVE", { exact: true }).first().waitFor();
        await integration.scrollIntoViewIfNeeded();
        await caption(name, "This connection test retrieved actual public data and is labelled LIVE. It requires no workspace account.", 8);
      }
    }
    await caption("OpenCrewBot 2.0", "The README includes local setup, provider configuration, test evidence, and a guide for repeating these scenarios with live credentials.", 12);
  }
}
try {
  await start();
  await openApp();
  await (evidenceDirectory ? recordEvidence() : recordRehearsal());
  success = true;
} catch (error) {
  console.error(error, logs.slice(-3000));
  await page.screenshot({ path: join(base, "failed-step.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context.close();
  if (success) {
    const output = join(base, evidenceDirectory ? "OpenCrewBot-2.0-live-evidence.webm" : "OpenCrewBot-2.0-demo.webm");
    await video.saveAs(output);
    await video.delete();
    console.log(`Recorded demo: ${output}`);
  }
  await browser.close();
  await stop();
}
