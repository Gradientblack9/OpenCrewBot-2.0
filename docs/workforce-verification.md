# Verification results

The production build passed on Windows using Node.js 24.14.1, pnpm 11.25.0 and Next.js 16.4.5. ESLint, TypeScript in the production build and `git diff --check` passed. The original MIT license file matched the upstream checkout. Chromium opened the Workforce workspace at desktop size, and the workspace fit a 390 px mobile viewport and returned to chat on close. A browser regression check confirmed the spreadsheet section carries the LOCAL label, clears the file input after submission, and leaves the next run's request free of the previous attachment.

## Production test suite

Run `pnpm build` followed by `pnpm test:workforce`. All 18 checks passed with `WORKFORCE_TEST_PUBLIC=1` and `WORKFORCE_TEST_SCHEDULE=1`. The suite started a production server with isolated data, called the localhost API, stopped the process during a worker call, and restarted the same database. It writes its machine-readable results under `data/workforce-checks`.

| Check | Observed result |
| --- | --- |
| Upstream app and seeded Workforce | App booted with 8 agents, 4 rooms, 8 skills and 8 Workforce tools. |
| Agent factory | Natural-language creation persisted Cedar and immediately added it to Business Operations. |
| CSV analysis | Calculated 700 leads and INR 1,080,000 in revenue from the provided fictional rows. Returned a local funnel chart and a separately labelled simulated narrative. |
| Approval rejection | Exact issue content appeared in Ask First. Rejecting it produced an audit event with zero tool dispatches. A second decision failed. |
| Append-only audit | SQLite refused deletion of journal rows. |
| Manual scheduling | Created a recurring workflow, triggered it manually, completed the report, paused and resumed. |
| Controlled Access | A pre-approved allowlisted lookup ran in simulation without pausing for approval. |
| Model fallback and parallel task graph | A local fixture deliberately returned HTTP 503, the fallback was selected, two independent tasks overlapped, and review and synthesis completed. |
| Bounded peer verification | A review handoff triggered one peer verification. The final report depended on its result. |
| Live-mode write guard | A test planner proposed a real GitHub target. Full Access still required approval. Rejection occurred before the dispatch stage. |
| Bounded failure handling | Two backoffs led to a terminal planning failure. Updating the fixture model and retrying safely produced a completed report. |
| Process restart recovery | Killing the server during a worker response left the run durable. Restart requeued the interrupted task and the same run completed. |
| Memory and replanning | Agent and shared preferences survived restart. Editing the preference Markdown on disk changed the next run, and the amended run linked to the previous one. |
| GitHub | Read Studio1-OSS/OpenCrewBot public repository metadata from the GitHub REST API. |
| DeepWiki MCP | Retrieved public documentation structure for microsoft/TypeScript. |
| Microsoft Learn MCP | Retrieved public Microsoft Learn results for the Azure Functions TypeScript developer guide. |
| Public webpage | Retrieved and extracted MeetUniversity's About page without a search API key. |
| Automatic scheduling | A due recurring slot created a distinct run and recorded a scheduled audit event with no manual trigger. |

The regression tests use a controlled model fixture for forced failures and interruption. GitHub, DeepWiki, Microsoft Learn and the public webpage test make actual read-only network requests. The suite used no hosted model credentials, Tavily account, Slack workspace or repository write token. The running workspace also has all eight direct-chat agents and its Workforce planner and workers configured for local Qwen3 1.7B.

The [release assets](https://github.com/Gradientblack9/OpenCrewBot-2.0/releases/tag/v2.0.0) include a 6 minute 29 second captioned walkthrough showing the seven assignment scenarios in simulated mode. It includes real SQLite and Markdown behavior, spreadsheet calculations, approvals and three public connection checks. See the [MeetUniversity guide](../examples/DEMO.md) for live reproduction and the [reviewer reference](../examples/MEETUNIVERSITY.md) for hand-checked comparison facts, campaign materials and sample CSV results.
