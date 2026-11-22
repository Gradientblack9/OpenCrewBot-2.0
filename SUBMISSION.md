# EDXSO AI Engineer Intern · Assignment 3

## OpenCrewBot 2.0 · Autonomous AI Workforce

OpenCrewBot 2.0 extends the MIT-licensed [Studio1-OSS project](https://github.com/Studio1-OSS/OpenCrewBot) with task planning, parallel and sequential execution, peer review, human approvals, editable Markdown memory, and recurring workflows. The initial workspace includes eight configurable agents, four collaboration rooms, and eight reusable skills.

## Submission links

| Deliverable | Link |
| --- | --- |
| Public GitHub fork and full source | [Gradientblack9/OpenCrewBot-2.0](https://github.com/Gradientblack9/OpenCrewBot-2.0) |
| Screen-recorded demo | [Watch on Google Drive](https://drive.google.com/file/d/1bPhSuJWvdu4vs-1zfHJlJY1jijlrF0IK/view?usp=sharing) · [Download the 8-minute, 27-second GitHub recording](https://github.com/Gradientblack9/OpenCrewBot-2.0/releases/download/v2.0.1/OpenCrewBot-2.0-assignment-demo.webm) · [Release and assets](https://github.com/Gradientblack9/OpenCrewBot-2.0/releases/tag/v2.0.1) |
| Installation, usage, and troubleshooting | [README](README.md#opencrewbot-20-workforce) · [Local Qwen setup](README.md#local-agent-chat) |
| Technical architecture, costs, and limitations | [Workforce architecture](docs/workforce-architecture.md) |
| Changes from upstream | [Feature audit](docs/workforce-feature-audit.md) |
| Test results and recovery evidence | [Verification summary](docs/workforce-verification.md) · [19-check report](https://github.com/Gradientblack9/OpenCrewBot-2.0/releases/download/v2.0.1/workforce-regression-results.json) |
| MeetUniversity demo evidence and reproduction | [Seven live case traces](https://github.com/Gradientblack9/OpenCrewBot-2.0/releases/download/v2.0.1/meetuniversity-live-evidence.json) · [Demo guide](examples/DEMO.md) · [Reviewer reference](examples/MEETUNIVERSITY.md) · [Sample sales CSV](examples/meetuniversity-sales.csv) |
| License and attribution | [Original MIT license](LICENSE) · [Dependency and model licenses](docs/workforce-architecture.md#dependency-and-cost-breakdown) |

## Run the app locally

The application runs on localhost. Tested on Windows with Node.js 24.14.1, pnpm 11.25.0, and Qwen3 1.7B through llama.cpp. Use Node.js 22.13 or newer and pnpm.

```sh
git clone https://github.com/Gradientblack9/OpenCrewBot-2.0.git
cd OpenCrewBot-2.0
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) after starting the app, then select **Workforce**. Choose **Simulated** to try the workflow immediately. For **Live** model runs, follow the [local Qwen setup](README.md#local-agent-chat). The local model uses the machine's compute and storage and incurs no model API charges. Optional hosted models and integrations have their own credentials and costs.

## Demonstrations and verification

The GitHub recording opens with the seven live MeetUniversity cases and follows with a labelled simulated walkthrough of the controls. The cases cover competitor research, a 30-day Class 11 campaign, analysis of a fictional sales CSV, a GitHub source review, an automatic competitor report, memory after restart and correction, and rejection of a proposed GitHub issue before dispatch.

| Label | What it means |
| --- | --- |
| **LIVE** | Actual model or service responses. The verified read integrations are GitHub, DeepWiki MCP, and Microsoft Learn MCP. |
| **LOCAL** | Computed by the app, such as spreadsheet totals and the funnel chart. |
| **SIMULATED** | Offline planning, draft output, and mocked external tool responses. |

All 19 production checks passed, including interruption and restart recovery, durable memory, automatic scheduling, and zero dispatches after rejection. The engineering model draft contained unsupported claims about unused symbols. The [reviewer reference](examples/MEETUNIVERSITY.md#read-only-development-review) contains the source-checked development plan. The model token cap applies per call. A configurable aggregate budget per room remains unfinished.
