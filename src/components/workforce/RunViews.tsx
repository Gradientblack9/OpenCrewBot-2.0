"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowRight, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Room } from "@/lib/shared/types";
import type { AuditEvent, PlannerMode, RunInput, RunMode, TaskOutput, ToolId, WorkRun, WorkTask } from "@/lib/shared/workforce";
import { Button, Field, inputClass } from "../ui";

export type RunView = Omit<WorkRun, "input"> & { input: Omit<RunInput, "csv"> & { attachment?: string } };
export type Catalog = Record<ToolId, { label: string; description: string; access: "local" | "read" | "write" }>;
export type Send = <T = { ok: true }>(value: object) => Promise<T | undefined>;
export const card = "min-w-0 rounded-2xl border border-line-strong bg-raised/60 p-4 sm:p-5";
export const heading = "text-[17px] font-semibold tracking-tight";
export const date = (value?: string) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
export const toggle = <T,>(values: T[], item: T, on: boolean) => on ? [...new Set([...values, item])] : values.filter((value) => value !== item);

export function Badge({ children }: { children: ReactNode }) {
  const label = String(children);
  const color = /^(LIVE|LOCAL|completed|done|approved)$/.test(label) ? "text-ok" : /failed|reject/.test(label) ? "text-danger" :
    /waiting|approval|SIMULATED/.test(label) ? "text-warn" : "text-mute";
  return <span className={`inline-flex w-fit rounded-md border border-line-strong px-2 py-0.5 text-[11px] font-medium capitalize ${color}`}>{children}</span>;
}

export function Output({ output }: { output: TaskOutput }) {
  const max = Math.max(1, ...(output.chart ?? []).map(({ value }) => Math.abs(value)));
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{output.mode}</Badge>
        {output.usage && <span className="font-mono text-xs text-mute">{output.usage.model} · {output.usage.input + output.usage.output} tokens · {output.usage.costUsd === null ? "unpriced" : `$${output.usage.costUsd.toFixed(5)}`}</span>}
      </div>
      {!!output.chart?.length && <figure aria-label="Calculated values by metric" className="space-y-2 rounded-xl bg-app p-3">
        {output.chart.map(({ label, value }, index) => (
          <div key={index} className="grid grid-cols-[minmax(75px,1fr)_3fr_minmax(55px,auto)] items-center gap-2 text-xs">
            <span className="truncate" title={label}>{label}</span>
            <div className="h-2 rounded-full bg-raised-2" aria-hidden><div className="h-full rounded-full bg-accent" style={{ width: `${100 * Math.abs(value) / max}%` }} /></div>
            <span className="text-right font-mono">{value.toLocaleString()}</span>
          </div>
        ))}
      </figure>}
      <div className="prose-chat overflow-x-auto text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{output.markdown}</ReactMarkdown></div>
      {output.followUp && <div className="rounded-lg border border-line bg-app p-3 text-sm">
        <p className="font-medium">Reviewer follow-up</p>
        <p className="mt-1 text-mute">{output.followUp.instruction}</p>
      </div>}
    </div>
  );
}

export function RunForm({ rooms, roomId, schedule, onSave }: {
  rooms: Room[]; roomId?: string; schedule?: boolean;
  onSave: (value: RunInput & { name?: string; intervalMinutes?: number }) => Promise<boolean>;
}) {
  const [input, setInput] = useState({ roomId: roomId || rooms[0]?.id || "", instruction: "", project: "workspace", mode: "mock" as RunMode, planner: "model" as PlannerMode, sequential: false });
  const [file, setFile] = useState<File>();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [interval, setInterval] = useState(1440);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof typeof input,>(key: K, value: (typeof input)[K]) => setInput((prev) => ({ ...prev, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (file && (file.size > 500_000 || !file.name.toLowerCase().endsWith(".csv"))) { setError("Choose a CSV file under 500 KB."); return; }
    setSaving(true);
    try {
      const csv = file ? { name: file.name, text: await file.text() } : undefined;
      if (await onSave({ ...input, csv, name, intervalMinutes: interval })) {
        set("instruction", "");
        setFile(undefined);
        if (fileInput.current) fileInput.current.value = "";
      }
    } catch { setError("The attachment could not be read."); }
    finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} className={`${card} space-y-4`}>
      <h2 className={heading}>{schedule ? "New recurring workflow" : "Give your team a task"}</h2>
      {schedule && <Field label="Workflow name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={90} /></Field>}
      <Field label="Instruction">
        <textarea className={`${inputClass} min-h-24 resize-y`} required maxLength={8000} value={input.instruction}
          onChange={(e) => set("instruction", e.target.value)} placeholder="Analyze sales conversion by channel and recommend changes to test." />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Room"><select className={inputClass} value={input.roomId} required onChange={(e) => set("roomId", e.target.value)}>
          <option value="" disabled>Select a room</option>
          {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select></Field>
        <Field label="Project" hint="Letters, numbers, hyphens or underscores"><input className={inputClass} value={input.project} required pattern="[a-zA-Z0-9_\-]+" maxLength={50} onChange={(e) => set("project", e.target.value)} /></Field>
        <Field label="Run mode"><select className={inputClass} value={input.mode} onChange={(e) => set("mode", e.target.value as RunMode)}>
          <option value="mock">Simulated</option><option value="live">Live</option>
        </select></Field>
        <Field label="Collaboration"><select className={inputClass} value={input.sequential ? "sequential" : "parallel"} onChange={(e) => set("sequential", e.target.value === "sequential")}>
          <option value="parallel">Parallel</option><option value="sequential">Sequential</option>
        </select></Field>
        {input.mode === "live" && <Field label="Planning" hint="Rules work well with explicit steps, source URLs or a spreadsheet.">
          <select className={inputClass} value={input.planner} onChange={(e) => set("planner", e.target.value as PlannerMode)}>
            <option value="model">Model plans the work</option><option value="rules">Rules plan the work</option>
          </select>
        </Field>}
      </div>
      {schedule ? <Field label="Repeat every (minutes)"><input type="number" className={inputClass} value={interval} min={1} max={43200} required onChange={(e) => setInterval(Number(e.target.value))} /></Field>
        : <Field label="Spreadsheet (optional)"><input ref={fileInput} type="file" accept=".csv,text/csv" className="max-w-full text-xs text-mute file:mr-3 file:rounded-lg file:border-0 file:bg-raised-2 file:px-3 file:py-2 file:text-ink" onChange={(e) => setFile(e.target.files?.[0])} /></Field>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" disabled={saving || !input.roomId}>{saving ? "Submitting…" : schedule ? "Create schedule" : "Start run"} <ArrowRight size={15} /></Button>
    </form>
  );
}

export function Audit({ entries }: { entries: AuditEvent[] }) {
  return (
    <details className={card}>
      <summary className="cursor-pointer text-sm font-medium">Audit log ({entries.length})</summary>
      <ol className="mt-3 divide-y divide-line">
        {entries.map((entry, index) => <li key={index} className="py-2.5 text-xs">
          <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{entry.event.replaceAll("_", " ")}</span><time className="text-mute">{date(entry.at)}</time></div>
          <p className="mt-1 break-words text-mute">{entry.taskId ? `${entry.taskId} · ` : ""}{entry.detail}</p>
        </li>)}
      </ol>
    </details>
  );
}

export function ActionPreview({ task, mode, tools, decide }: { task: WorkTask; mode: RunMode; tools?: Catalog; decide?: (approve: boolean) => void }) {
  if (!task.tool) return null;
  return (
    <div className="space-y-3 rounded-xl border border-warn/30 bg-warn-soft p-3">
      <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{tools?.[task.tool.id].label ?? task.title}</strong><Badge>{task.tool.id === "csv" ? "LOCAL" : mode === "mock" ? "SIMULATED" : "LIVE"}</Badge></div>
      <dl className="grid grid-cols-[minmax(50px,auto)_1fr] gap-x-4 gap-y-1.5 text-xs">
        {Object.entries(task.tool.args).map(([key, value]) => <div className="contents" key={key}><dt className="text-mute">{key}</dt><dd className="whitespace-pre-wrap break-all">{value}</dd></div>)}
      </dl>
      {decide && <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => decide(true)}>Approve once</Button><Button size="sm" variant="danger" onClick={() => decide(false)}>Reject</Button></div>}
    </div>
  );
}

function downloadReport(run: RunView, output: TaskOutput) {
  const url = URL.createObjectURL(new Blob([`<!-- ${output.mode} | run ${run.id} -->\n\n${output.markdown}`], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${run.input.project}-${run.id.slice(0, 8)}.md`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RunDetail({ run, audit, send, tools, onSelect }: {
  run: RunView; audit: AuditEvent[]; send: Send; tools?: Catalog; onSelect: (id: string) => void;
}) {
  const [revision, setRevision] = useState("");
  const report = run.tasks.find((task) => task.kind === "report")?.output;
  const active = ["planning", "running", "waiting"].includes(run.status);
  const change = async (command: string, instruction?: string) => {
    const result = await send<{ id: string }>({ action: "change-run", id: run.id, command, instruction });
    if (result) { onSelect(result.id); setRevision(""); }
  };
  const layers = new Map<string, number>();
  for (const task of run.tasks) layers.set(task.id, Math.max(0, ...task.dependencies.map((dep) => (layers.get(dep) ?? 0) + 1)));
  const depth = Math.max(-1, ...layers.values());
  const usage = [run.planningUsage, ...run.tasks.map((task) => task.output?.usage)].filter((entry) => !!entry);
  const tokens = usage.reduce((total, entry) => total + entry.input + entry.output, 0);
  const cost = usage.reduce((total, entry) => total + (entry.costUsd ?? 0), 0);
  return (
    <div className="min-w-0 space-y-4" aria-label="Run detail">
      <div className={`${card} space-y-3`}>
        <div className="flex gap-2"><Badge>{run.status}</Badge><Badge>{run.input.mode === "mock" ? "SIMULATED" : "LIVE"}</Badge></div>
        <h2 className="text-xl font-semibold tracking-tight">{run.input.project}</h2>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{run.input.instruction}</p>
        <p className="text-xs text-mute">{date(run.createdAt)} · {run.input.sequential ? "Sequential" : "Parallel"}{run.input.attachment ? ` · ${run.input.attachment}` : ""}</p>
        {tokens > 0 && <p className="text-xs text-mute">{tokens.toLocaleString()} recorded tokens · ${cost.toFixed(5)} priced calls{usage.some((entry) => entry.costUsd === null) ? " + unpriced calls" : ""}</p>}
        {run.parentId && <button className="text-xs text-[#8db4ff] hover:underline" onClick={() => onSelect(run.parentId!)}>Open previous run</button>}
        {run.error && <p role="status" className="text-sm text-danger">{run.error}</p>}
        <div className="flex flex-wrap gap-2">
          {active && <Button size="sm" variant="danger" onClick={() => void change("cancel")}>Cancel run</Button>}
          {run.status === "failed" && <Button size="sm" onClick={() => void change("retry")}>Retry failed steps</Button>}
          {report && <Button size="sm" onClick={() => downloadReport(run, report)}><Download size={14} /> Report</Button>}
        </div>
        <details className="border-t border-line pt-3">
          <summary className="cursor-pointer text-sm text-mute">Revise instruction</summary>
          <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void change("amend", revision); }}>
            <textarea className={inputClass} rows={3} required value={revision} onChange={(e) => setRevision(e.target.value)} aria-label="Revised instruction" />
            <Button size="sm" type="submit">Replan with completed context</Button>
          </form>
        </details>
      </div>
      {report && <section className={card}><h2 className={`${heading} mb-3`}>Final deliverable</h2><Output output={report} /></section>}
      <section className={`${card} space-y-3`}>
        <h2 className={heading}>Execution plan</h2>
        {!run.tasks.length && <p className="text-sm text-mute">{active ? "Chief of Staff is preparing the plan." : "No plan was committed."}</p>}
        {Array.from({ length: depth + 1 }, (_, index) => {
          const tasks = run.tasks.filter((task) => layers.get(task.id) === index);
          return <div key={index}>
            {index > 0 && <ArrowDown size={16} className="mx-auto mb-2 text-faint" aria-hidden />}
            <div className={`grid gap-2 ${tasks.length > 1 ? "sm:grid-cols-2" : ""}`}>
              {tasks.map((task) => <details key={task.id} open={task.status === "approval" ? true : undefined} className="min-w-0 rounded-xl border border-line-strong bg-app/70 p-3">
                <summary className="cursor-pointer text-sm"><span className="ml-1 font-medium">{task.title}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-mute"><Badge>{task.status}</Badge>{task.botName} · {task.id}</span></summary>
                <div className="mt-3 space-y-3 text-xs">
                  <p className="leading-relaxed text-mute">{task.instruction}</p>
                  <p className="text-mute">{task.dependencies.length ? `Handoffs from ${task.dependencies.join(", ")}` : "No dependencies"}{task.skill ? ` · ${task.skill}` : ""}</p>
                  {task.startedAt && <p className="text-mute">Attempt {task.attempts} · {date(task.startedAt)} → {date(task.finishedAt)}</p>}
                  {task.error && <p className="text-danger">{task.error}</p>}
                  {task.tool && <ActionPreview task={task} mode={run.input.mode} tools={tools} decide={task.status === "approval" ? (approve) => void send({ action: "approval", id: run.id, taskId: task.id, approve }) : undefined} />}
                  {task.toolOutput && <Output output={task.toolOutput} />}
                  {task.output && task.kind !== "report" && <Output output={task.output} />}
                </div>
              </details>)}
            </div>
          </div>;
        })}
      </section>
      <Audit entries={audit} />
    </div>
  );
}
