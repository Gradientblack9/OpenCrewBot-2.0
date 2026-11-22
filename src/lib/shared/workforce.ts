export type RunStatus = "planning" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type TaskStatus = "queued" | "running" | "approval" | "done" | "failed" | "rejected" | "skipped" | "cancelled";
export type EvidenceMode = "LIVE" | "SIMULATED" | "LOCAL";
export type ToolId = "csv" | "web_search" | "web_extract" | "github_read" | "github_issue" | "deepwiki" | "learn_docs" | "slack_post";
export type TaskKind = "work" | "review" | "verify" | "report";
export type RunMode = "mock" | "live";
export type PlannerMode = "model" | "rules";

export interface ToolCall {
  id: ToolId;
  args: Record<string, string>;
}

export interface Usage {
  model: string;
  input: number;
  output: number;
  costUsd: number | null;
}

export interface TaskOutput {
  markdown: string;
  mode: EvidenceMode;
  usage?: Usage;
  chart?: { label: string; value: number }[];
  followUp?: { kind: "question" | "verify" | "delegate"; instruction: string };
}

export interface WorkTask {
  id: string;
  title: string;
  instruction: string;
  botId: string;
  botName: string;
  kind: TaskKind;
  skill?: string;
  dependencies: string[];
  tool?: ToolCall;
  status: TaskStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  retryAt?: string;
  dispatchedAt?: string;
  error?: string;
  approval?: { status: "pending" | "approved" | "rejected" | "cancelled"; at: string };
  output?: TaskOutput;
  toolOutput?: TaskOutput;
}

export interface RunInput {
  roomId: string;
  instruction: string;
  mode: RunMode;
  planner?: PlannerMode;
  sequential: boolean;
  project: string;
  csv?: { name: string; text: string };
}

export interface WorkRun {
  id: string;
  input: RunInput;
  status: RunStatus;
  tasks: WorkTask[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  scheduleId?: string;
  parentId?: string;
  priorContext?: string;
  error?: string;
  planningAttempts: number;
  planningRetryAt?: string;
  planningUsage?: Usage;
}

export type RunSummary = Pick<WorkRun, "id" | "status" | "createdAt" | "updatedAt" | "scheduleId" | "parentId"> & {
  instruction: string;
  project: string;
  mode: RunMode;
};

export interface AuditEvent {
  runId: string;
  taskId?: string;
  at: string;
  event: string;
  detail: string;
}

export interface Schedule {
  id: string;
  name: string;
  input: Omit<RunInput, "csv">;
  intervalMinutes: number;
  nextAt: string;
  paused: boolean;
}

export interface ProviderSettings {
  planning: string;
  defaultModel: string;
  fallback: string;
  maxOutputTokens: number;
}

export interface WorkforceProfile {
  skills: string[];
  allowedTools: ToolId[];
  preapproved: ToolId[];
  outputFormat: string;
  model?: string;
  disabled?: boolean;
}

export type MemoryScope = "agent" | "room" | "project" | "preferences" | "decisions" | "history";
