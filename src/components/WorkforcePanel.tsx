"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ClipboardList, History, Network, Notebook, Plug, ShieldCheck, SlidersHorizontal, Users, X } from "lucide-react";
import type { AuditEvent, RunMode, RunSummary, WorkTask } from "@/lib/shared/workforce";
import { useApp } from "./OpenCrewBotApp";
import { Button, IconButton, inputClass } from "./ui";
import { AgentManager, CatalogSettings, Integrations, MemoryEditor, Models, request, type Config } from "./workforce/Management";
import { ActionPreview, Audit, Badge, RunDetail, RunForm, card, date, heading, type RunView, type Send } from "./workforce/RunViews";

type Approval = { runId: string; project: string; mode: RunMode; task: WorkTask };
const views = [
  { id: "runs", label: "Runs", icon: ClipboardList },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "agents", label: "Agents", icon: Users },
  { id: "memory", label: "Memory", icon: Notebook },
  { id: "catalog", label: "Skills & tools", icon: SlidersHorizontal },
  { id: "connections", label: "Integrations", icon: Plug },
  { id: "models", label: "Models", icon: Network },
] as const;
type View = typeof views[number]["id"];

export function WorkforcePanel({ onClose, roomId }: { onClose: () => void; roomId?: string }) {
  const { state, setPanel, open, setInspector, refresh } = useApp();
  const [view, setView] = useState<View>("runs");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<{ run: RunView; audit: AuditEvent[] }>();
  const [pending, setPending] = useState<{ approvals: Approval[]; audit: AuditEvent[] }>();
  const [config, setConfig] = useState<Config>();
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const scheduleVersion = view === "schedules" ? state.workforceVersion : 0;
  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const send: Send = async <T,>(value: object) => {
    setError("");
    try {
      const result = await request<T>("", value);
      reload();
      return result;
    } catch (error) { setError(error instanceof Error ? error.message : "Request failed."); }
  };
  const select = (id: string) => { setSelected(id); setView("runs"); };
  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose]);
  useEffect(() => {
    let valid = true;
    request<Config>("view=config").then((result) => { if (valid) setConfig(result); }).catch((error: Error) => { if (valid) setError(error.message); });
    return () => { valid = false; };
  }, [version, view, scheduleVersion]);
  useEffect(() => {
    if (!["runs", "approvals", "schedules"].includes(view)) return;
    let valid = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const readRuns = view !== "approvals" ? request<{ runs: RunSummary[] }>(new URLSearchParams({ q: view === "runs" ? query : "" }).toString()) : undefined;
        const readDetail = selected && view === "runs" ? request<{ run: RunView; audit: AuditEvent[] }>(new URLSearchParams({ id: selected }).toString()) : undefined;
        const readApprovals = view === "approvals" ? request<{ approvals: Approval[]; audit: AuditEvent[] }>("view=approvals") : undefined;
        const [history, run, approvals] = await Promise.all([readRuns, readDetail, readApprovals]);
        if (valid) { if (history) setRuns(history.runs); if (run) setDetail(run); if (approvals) setPending(approvals); }
      } catch (error) { if (valid) setError(error instanceof Error ? error.message : "Could not load execution history."); }
      finally { inFlight = false; }
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => { valid = false; window.clearInterval(timer); };
  }, [selected, query, version, view, state.workforceVersion]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Workforce" className="fixed inset-0 z-40 flex flex-col bg-app text-ink">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-side px-4 py-3.5 sm:px-8">
        <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-[#8db4ff]"><Network size={20} /></span>
        <div className="flex-1"><p className="text-xs text-mute">OpenCrewBot 2.0</p><h1 className="text-xl font-semibold leading-tight tracking-tight">Workforce</h1></div>
        <IconButton label="Close Workforce" className="bg-raised" onClick={onClose}><X size={19} /></IconButton>
      </header>
      <nav aria-label="Workforce sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-side px-3 py-2 sm:px-7">
        {views.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={id === view ? "page" : undefined}
          className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm ${id === view ? "bg-accent-soft text-[#a4c4ff]" : "text-mute hover:bg-raised hover:text-ink"}`}
          onClick={() => { setError(""); setView(id); }}><Icon size={15} />{label}</button>)}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1450px] space-y-4 p-4 sm:p-7">
          {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
          {view === "runs" && <div className="grid items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-4">
              {state.loaded && <RunForm rooms={state.rooms} roomId={roomId} onSave={async (input) => {
                const result = await send<{ id: string }>({ ...input, action: "start" });
                if (result) select(result.id);
                return Boolean(result);
              }} />}
              <section className={`${card} space-y-3`}>
                <h2 className={`${heading} flex items-center gap-2`}><History size={16} /> Execution history</h2>
                <input className={inputClass} type="search" aria-label="Search run history" placeholder="Search runs" value={query} onChange={(e) => setQuery(e.target.value)} />
                {!runs.length && <p className="text-sm text-mute">No matching runs.</p>}
                <ul className="max-h-80 divide-y divide-line overflow-y-auto">
                  {runs.map((run) => <li key={run.id}>
                    <button type="button" onClick={() => select(run.id)} aria-current={selected === run.id ? "true" : undefined} className={`w-full rounded-lg p-2 text-left hover:bg-hover ${selected === run.id ? "bg-raised-2" : ""}`}>
                      <span className="flex justify-between gap-2 text-sm"><strong className="truncate">{run.project}</strong><Badge>{run.status}</Badge></span>
                      <span className="mt-1 block truncate text-xs text-mute">{run.instruction}</span>
                      <span className="mt-1 block text-xs text-faint">{date(run.createdAt)} · {run.mode === "mock" ? "Simulated" : "Live"}</span>
                    </button>
                  </li>)}
                </ul>
              </section>
            </div>
            {selected && detail?.run.id === selected
              ? <RunDetail key={selected} {...detail} send={send} tools={config?.tools} onSelect={select} />
              : <div className={`${card} flex min-h-56 items-center justify-center text-sm text-mute`}>{selected ? "Loading run…" : "Start a run or select one from execution history."}</div>}
          </div>}
          {view === "approvals" && <div className="space-y-4">
            <section className={`${card} space-y-4`}>
              <h2 className={heading}>Pending approvals</h2>
              {!pending?.approvals.length && <p className="text-sm text-mute">{pending ? "No actions waiting for approval." : "Loading approvals…"}</p>}
              {pending?.approvals.map(({ runId, task, mode, project }) => <div key={`${runId}/${task.id}`} className="space-y-2">
                <button className="text-sm text-[#8db4ff] hover:underline" onClick={() => select(runId)}>{project} · {task.botName} · Open run</button>
                <ActionPreview task={task} tools={config?.tools} mode={mode} decide={(approve) => void send({ action: "approval", id: runId, taskId: task.id, approve })} />
              </div>)}
            </section>
            <Audit entries={pending?.audit ?? []} />
          </div>}
          {view === "schedules" && config && <div className="grid items-start gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <RunForm key="schedule" rooms={state.rooms} roomId={roomId} schedule onSave={async (input) => Boolean(await send({ action: "create-schedule", ...input }))} />
            <div className="space-y-3">
              {!config.schedules.length && <p className={`${card} text-sm text-mute`}>No workflows scheduled.</p>}
              {config.schedules.map((schedule) => <section className={`${card} space-y-3`} key={schedule.id}>
                <div className="flex flex-wrap items-center justify-between gap-2"><h2 className={heading}>{schedule.name}</h2><Badge>{schedule.paused ? "paused" : "active"}</Badge></div>
                <p className="text-sm text-mute">Every {schedule.intervalMinutes} minutes · {schedule.paused ? "Paused" : `Next ${date(schedule.nextAt)}`} · {schedule.input.mode === "mock" ? "Simulated" : "Live"}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={async () => {
                    const result = await send<{ id?: string }>({ action: "change-schedule", id: schedule.id, command: "run" });
                    if (result?.id) select(result.id);
                  }}>Run now</Button>
                  <Button size="sm" onClick={() => void send({ action: "change-schedule", id: schedule.id, command: schedule.paused ? "resume" : "pause" })}>{schedule.paused ? "Resume" : "Pause"}</Button>
                </div>
                <ul className="space-y-1">{runs.filter((run) => run.scheduleId === schedule.id).slice(0, 8).map((run) => <li key={run.id}>
                  <button className="flex w-full justify-between gap-2 rounded-lg border border-line p-2 text-left text-xs hover:bg-hover" onClick={() => select(run.id)}>{date(run.createdAt)} <Badge>{run.status}</Badge></button>
                </li>)}</ul>
              </section>)}
            </div>
          </div>}
          {view === "agents" && config && <AgentManager bots={state.bots} rooms={state.rooms} config={config} send={send} refresh={refresh} roomId={roomId}
            open={(id) => { open(`dm:${id}`); setInspector({ open: true, tab: "details" }); onClose(); }} />}
          {view === "memory" && <MemoryEditor bots={state.bots} rooms={state.rooms} project={detail?.run.input.project} send={send} />}
          {view === "catalog" && config && <CatalogSettings config={config} send={send} />}
          {view === "models" && config && <Models config={config} send={send} />}
          {view === "connections" && config && <Integrations config={config} send={send} manage={() => setPanel({ kind: "connections" })} />}
        </div>
      </div>
    </div>
  );
}
