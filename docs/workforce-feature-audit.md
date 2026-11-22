# Upstream feature audit

The extension starts from Studio1-OSS/OpenCrewBot commit `4784e3abd96fc62ac5fd7a08f025102771a5bbaa`. The original Next.js interface, Mastra chat runtime, app data, Markdown memory and MIT attribution remain the foundation.

| Area | Upstream source and behavior | Workforce extension |
| --- | --- | --- |
| Routing | `rooms.ts` selects one or several responders through mentions, lead rules or Jev. Handoffs were limited to short mention chains. | Room roster and capabilities feed a Chief of Staff planner. Validated task graph, parallel/sequential execution, review and synthesis. |
| Agent setup | `service.ts` creates profiles from a manual form with an editable persona, tools and Nebius model. Three profiles and one room were seeded. | Natural-language factory, profile cloning, model/tool allowlist overrides and room assignment. Eight starting profiles and four rooms. |
| Task persistence | `runtime.ts` folds transient Mastra events into persisted messages. The app marks interrupted chat turns stopped. | Durable runs and task state, attempts, bounded backoff, timeout, cancellation, restart recovery and searchable history. |
| Memory | `memory-files.ts` reads and writes one editable `MEMORY.md` per bot and redacts common credential forms. | Room, project, preferences, decisions and task history. Editable paths and an edit provenance record. |
| Skills and tools | Tavily, Browserbase, QuickJS, memory, MCP and Composio work through upstream tools and connection permissions. There was no reusable skill catalog. | Eight file-based skills, global switches and per-agent tool access. Added direct CSV, GitHub, Slack and public MCP operations. |
| Approval | Upstream Ask First and Full Access used Mastra categories for browser and connector calls. | Dedicated Workforce approval queue, Controlled Access, immutable audit events and replay prevention. Workforce external writes always ask. |
| Integrations | Composio OAuth and remote MCP configuration existed. Upstream README distinguished staging and service paths still to verify. | Direct public GitHub, DeepWiki and Microsoft Learn calls, plus optional Tavily and Slack. Explicit live connection tests. |
| Automation | No recurring workflow runner in the product. | Persisted intervals, pause/resume, manual triggers and history. |
| Models | Nebius catalog and per-bot model. Scripted offline output and upstream chat cost estimates. | Independent planner/worker routing, OpenAI-compatible endpoints, local models and fallback. Usage per task and total per run. |
| UI | Sidebar, chat, room/bot editors, inspector, settings and connectors. | Workforce overlay within the same app. Room header supports launching a run in that room. |
