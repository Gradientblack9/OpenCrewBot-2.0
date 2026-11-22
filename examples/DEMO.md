# MeetUniversity demonstration

Use the [reviewer reference](MEETUNIVERSITY.md) to check business facts and figures against the model output.

Start the app locally and open **Workforce**. The sample file `meetuniversity-sales.csv` contains fictional data. Its arithmetic is real, and the app labels it **LOCAL**. A run in the offline mode labels generated model and external tool responses **SIMULATED**. Claim live business results only after actually running a configured model with the relevant evidence tools.

To reproduce the seven cases with a local model, build the app, start your OpenAI-compatible local endpoint and run `node scripts/run-assignment-demo.mjs`. By default it uses `local:qwen3-1.7b` at `http://127.0.0.1:11435/v1`. Set `WORKFORCE_DEMO_MODEL` and `WORKFORCE_LOCAL_URL` for a different model or loopback endpoint. The script starts a separate production server, limits unattended access to its test workspace, clears hosted credentials, rejects the proposed GitHub write and saves reports and audit JSON under `data/assignment-demo/`. Pass any of `market`, `campaign`, `sales`, `engineering`, `schedule`, `memory` or `approval` to run selected cases. Set `WORKFORCE_DEMO_RESUME` to the eight-character directory name to rerun selected cases in an existing demo workspace.

For an interactive run, use project `meetuniversity` throughout, select **Live** mode, and approve the proposed reads. Use **Rules plan the work** with first-party HTTPS URLs. A room operator can pre-approve specific read tools under Controlled Access. Configure Tavily when you want the agents to discover URLs through search.

| Rehearsal offset | Demonstration | Room and instruction |
| --- | --- | --- |
| 0:00–0:45 | Workspace and specialists | Open the existing rooms, then Workforce → Agents. Create “Cedar, a specialist in Class 11 audience research and campaign data analysis” and add it to Studio. |
| 0:45–1:40 | Market intelligence | **Market Intelligence.** Research MeetUniversity's Study Abroad, Aspirations and School Partnerships. Compare overlapping alternatives by offering, buyer, public pricing and positioning. Give first-party URLs and strategic openings. Flag pricing you could not verify. Show independent tasks, review and consolidated table. |
| 1:40–2:25 | Marketing campaign | **Studio.** Research Class 11 students' concerns about subject and career choices. Develop a campaign for MeetUniversity Aspirations, draft two sample assets, and write a day-by-day 30-day content calendar. Separate supported insights from assumptions and include measurement. |
| 2:25–3:10 | Business analysis | **Business Operations.** Attach the sample CSV. Analyze conversion and revenue by channel, calculate the largest funnel drop and recommend two experiments. Open the spreadsheet task and show the chart. Expected totals are 700 leads, 274 qualified, 155 applications, 74 sales and ₹1,080,000 revenue. |
| 3:10–3:55 | Development team | **Engineering.** Inspect https://github.com/Studio1-OSS/OpenCrewBot for reliability and maintainability gaps. Cite retrieved artifacts and prepare a prioritized development plan with acceptance checks. Use a separate, explicitly requested approval step before any write. |
| 3:55–4:30 | Autonomous routine | **Schedules.** Create a recurring competitor price check in Market Intelligence, use **Run now**, and open its history. For a timer trigger during recording use a one-minute interval, then verify the automatic entry and pause it after the demo. |
| 4:30–5:20 | Memory | **Memory** → **Preferences** → **Load from disk**. Save “Use a numbered action list.” Stop and restart the app using the same data directory. Ask a room to recall preferences. Edit the displayed Markdown path to “Use one executive paragraph.” Open a new run and check the corrected preference. |
| 5:20–6:00 | Human intervention | **Engineering.** Use: `Create a GitHub issue in https://github.com/Studio1-OSS/OpenCrewBot titled "Verification only". Body: This is an approval rejection exercise.` Open **Approvals** and reject it. Show the rejected decision and the absence of a tool dispatch in the run audit. For rehearsal, use Simulated mode. |

## Record the local walkthrough

For a captioned browser recording of the offline walkthrough, build the app and run `node scripts/record-workforce.mjs`. Use a local Playwright installation with Chromium and its video encoder installed. If Playwright is installed outside this checkout, set `WORKFORCE_PLAYWRIGHT_PACKAGE` to its absolute `index.mjs` path. Set `WORKFORCE_RECORD_PUBLIC=1` to include three public read-only connection tests. The recording script uses isolated app data and writes the WebM path to the terminal.

After all seven live cases finish, set `WORKFORCE_RECORD_EVIDENCE` to that runner's evidence directory and run `node scripts/record-workforce.mjs` again. This opens the stored runs, source-backed reports and audit log in the production interface.

## Unseen problem rehearsal

Create a room named **Field Service** with Atlas and a new budget analyst. Submit one instruction asking the team to analyze a service pipeline CSV and draft a management summary. While the plan runs, revise the instruction to segment by region. Check the linked prior run and updated report. Open the Markdown memory path during the run, edit the expected style and start a subsequent run to confirm the correction.
