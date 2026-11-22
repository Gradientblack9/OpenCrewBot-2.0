import type { AuditEvent, RunSummary, Schedule, ToolId, WorkRun } from "@/lib/shared/workforce";
import { db, getSetting } from "../db";
import { publish } from "../bus";

export const disabledToolKey = "workforce.disabledTools";
export const disabledSkillKey = "workforce.disabledSkills";
export const disabledTools = async () => (await getSetting<ToolId[]>(disabledToolKey)) ?? [];
export const disabledSkills = async () => (await getSetting<string[]>(disabledSkillKey)) ?? [];
const active = "'planning','running','waiting'";

export async function getRun(id: string): Promise<WorkRun | undefined> {
  const result = await (await db()).execute({ sql: "SELECT data FROM workforce_runs WHERE id = ?", args: [id] });
  return result.rows[0] ? JSON.parse(String(result.rows[0].data)) : undefined;
}

export async function workingRuns(): Promise<WorkRun[]> {
  const result = await (await db()).execute(`SELECT data FROM workforce_runs WHERE status IN (${active}) ORDER BY created_at`);
  return result.rows.map((row) => JSON.parse(String(row.data)));
}

export async function runHistory(query: string): Promise<RunSummary[]> {
  const result = await (await db()).execute({
    sql: `SELECT id, status, created_at, updated_at, schedule_id,
       json_extract(data, '$.input.project') AS project,
       json_extract(data, '$.input.mode') AS mode,
       json_extract(data, '$.input.instruction') AS instruction,
       json_extract(data, '$.parentId') AS parent_id
       FROM workforce_runs
       WHERE ? = '' OR instr(lower(json_extract(data, '$.input.instruction') || ' ' || json_extract(data, '$.input.project') || ' ' || id), lower(?)) > 0
         OR EXISTS (SELECT 1 FROM json_each(workforce_runs.data, '$.tasks') AS task
           WHERE instr(lower(coalesce(json_extract(task.value, '$.output.markdown'), '')), lower(?)) > 0)
       ORDER BY created_at DESC LIMIT 100`,
    args: [query, query, query],
  });
  return result.rows.map((row) => ({
    id: String(row.id), status: row.status as RunSummary["status"], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    scheduleId: row.schedule_id ? String(row.schedule_id) : undefined, parentId: row.parent_id ? String(row.parent_id) : undefined,
    project: String(row.project), mode: row.mode as RunSummary["mode"], instruction: String(row.instruction),
  }));
}

function auditInsert(event: AuditEvent) {
  return {
    sql: "INSERT INTO workforce_audit (run_id, data) VALUES (?, ?)",
    args: [event.runId, JSON.stringify(event)],
  };
}

export function scheduleWrite(schedule: Schedule) {
  return {
    sql: `INSERT INTO workforce_schedules (id, data) VALUES (?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    args: [schedule.id, JSON.stringify(schedule)],
  };
}

interface RunChange {
  run: WorkRun;
  audit: AuditEvent[];
  isNew?: boolean;
  slot?: string;
}

export async function commit(changes: RunChange[], schedule?: Schedule) {
  const statements = changes.flatMap(({ run, audit, isNew, slot }) => [
    isNew ? {
      sql: "INSERT INTO workforce_runs(id, status, created_at, updated_at, schedule_id, schedule_slot, data) VALUES (?,?,?,?,?,?,?)",
      args: [run.id, run.status, run.createdAt, run.updatedAt, run.scheduleId ?? null, slot ?? null, JSON.stringify(run)],
    } : {
      sql: "UPDATE workforce_runs SET status = ?, updated_at = ?, data = ? WHERE id = ?",
      args: [run.status, run.updatedAt, JSON.stringify(run), run.id],
    },
    ...audit.map(auditInsert),
  ]);
  if (schedule) statements.push(scheduleWrite(schedule));
  if (statements.length) {
    await (await db()).batch(statements, "write");
    publish({ type: "workforce-changed" });
  }
}

export async function getAudit(id?: string): Promise<AuditEvent[]> {
  const result = await (await db()).execute(id ? {
    sql: "SELECT data FROM workforce_audit WHERE run_id = ? ORDER BY id DESC LIMIT 300",
    args: [id],
  } : "SELECT data FROM workforce_audit ORDER BY id DESC LIMIT 100");
  return result.rows.map((row) => JSON.parse(String(row.data)));
}

export async function approvals() {
  return (await workingRuns()).flatMap((run) => run.tasks.filter((task) => task.status === "approval").map((task) => ({
    runId: run.id, project: run.input.project, mode: run.input.mode, task,
  })));
}

export async function schedules(): Promise<Schedule[]> {
  const result = await (await db()).execute("SELECT data FROM workforce_schedules ORDER BY rowid DESC");
  return result.rows.map((row) => JSON.parse(String(row.data)));
}

export async function getSchedule(id: string): Promise<Schedule | undefined> {
  const result = await (await db()).execute({ sql: "SELECT data FROM workforce_schedules WHERE id = ?", args: [id] });
  return result.rows[0] ? JSON.parse(String(result.rows[0].data)) : undefined;
}
