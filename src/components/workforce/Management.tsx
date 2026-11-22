"use client";

import { useState } from "react";
import type { Bot, Room } from "@/lib/shared/types";
import type { MemoryScope, ProviderSettings, RunMode, Schedule, TaskOutput, ToolId, WorkforceProfile } from "@/lib/shared/workforce";
import { BotAvatar, Button, Field, inputClass } from "../ui";
import { Badge, Output, card, heading, toggle, type Catalog, type Send } from "./RunViews";

export type Config = {
  schedules: Schedule[];
  integrations: { id: string; name: string; ready: boolean; scopes: string }[];
  providers: { id: string; ready: boolean }[];
  settings: ProviderSettings;
  tools: Catalog;
  skills: { id: string; name: string; tools: ToolId[] }[];
  disabled: ToolId[];
  disabledSkills: string[];
};
type MemoryFile = { path: string; markdown: string; provenance: string };

export async function request<T>(query = "", value?: object): Promise<T> {
  const response = await fetch(`/api/workforce${query ? `?${query}` : ""}`, {
    cache: "no-store",
    ...(value ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Workforce request failed.");
  return result;
}

export function MemoryEditor({ bots, rooms, project, send }: { bots: Bot[]; rooms: Room[]; project?: string; send: Send }) {
  const scopes: MemoryScope[] = ["agent", "room", "project", "preferences", "decisions", "history"];
  const [scope, setScope] = useState<MemoryScope>("agent");
  const [owner, setOwner] = useState(bots[0]?.id || "");
  const [file, setFile] = useState<MemoryFile>();
  const [error, setError] = useState("");
  const load = async () => {
    setError("");
    try { setFile(await request<MemoryFile>(new URLSearchParams({ scope, owner }).toString())); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not read memory."); }
  };
  return (
    <section className={`${card} space-y-4`}>
      <h2 className={heading}>Memory manager</h2>
      <div className="grid items-end gap-3 sm:grid-cols-3">
        <Field label="Scope"><select className={inputClass} value={scope} onChange={(e) => {
          const value = e.target.value as MemoryScope;
          setScope(value); setFile(undefined); setOwner(value === "agent" ? bots[0]?.id || "" : value === "room" ? rooms[0]?.id || "" : value === "project" ? project || "workspace" : "");
        }}>{scopes.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></Field>
        {(scope === "agent" || scope === "room") && <Field label={scope === "agent" ? "Agent" : "Room"}><select className={inputClass} value={owner}
          onChange={(e) => { setOwner(e.target.value); setFile(undefined); }}>
          {(scope === "agent" ? bots : rooms).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></Field>}
        {scope === "project" && <Field label="Project"><input className={inputClass} value={owner} onChange={(e) => { setOwner(e.target.value); setFile(undefined); }} /></Field>}
        <Button onClick={() => void load()}>Load from disk</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {file && <>
        <p className="break-all font-mono text-xs text-mute">{file.path}</p>
        <Field label="Editable Markdown"><textarea className={`${inputClass} min-h-56 font-mono`} value={file.markdown} onChange={(e) => setFile({ ...file, markdown: e.target.value })} /></Field>
        <Button variant="primary" onClick={async () => {
          const saved = await send<MemoryFile>({ action: "memory", scope, id: owner, markdown: file.markdown });
          if (saved) setFile(saved);
        }}>Save memory</Button>
        {file.provenance && <details><summary className="cursor-pointer text-sm">Provenance</summary><pre className="mt-2 whitespace-pre-wrap text-xs text-mute">{file.provenance}</pre></details>}
      </>}
    </section>
  );
}

function AgentEditor({ bot, config, send, refresh, open }: { bot: Bot; config: Config; send: Send; refresh: () => Promise<void>; open: () => void }) {
  const [profile, setProfile] = useState<WorkforceProfile>(bot.workforce ?? {
    skills: [], allowedTools: ["csv", "github_read", "deepwiki", ...(bot.tools.webSearch ? ["web_search", "web_extract"] as const : [])],
    preapproved: [], outputFormat: "Markdown with evidence and open questions.",
  });
  const [approval, setApproval] = useState(bot.approval);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof WorkforceProfile,>(key: K, value: WorkforceProfile[K]) => { setSaved(false); setProfile((old) => ({ ...old, [key]: value })); };
  return (
    <form className={`${card} space-y-4`} onSubmit={async (e) => {
      e.preventDefault();
      if (await send({ action: "agent-profile", ...profile, id: bot.id, approval, model: profile.model ?? "", disabled: profile.disabled ?? false })) { await refresh(); setSaved(true); }
    }}>
      <div className="flex flex-wrap items-center gap-3"><BotAvatar bot={bot} /><div className="flex-1"><h2 className={heading}>{bot.name}</h2><p className="text-sm text-mute">{bot.title}</p></div><Button size="sm" onClick={open} type="button">Open profile & chat</Button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Permission level"><select className={inputClass} value={approval} onChange={(e) => { setSaved(false); setApproval(e.target.value as Bot["approval"]); }}>
          <option value="ask">Ask First</option><option value="controlled">Controlled Access</option><option value="full">Full Access</option>
        </select></Field>
        <Field label="Workforce model override"><input className={inputClass} value={profile.model || ""} placeholder="Uses configured default" onChange={(e) => set("model", e.target.value)} /></Field>
      </div>
      <Field label="Expected output format"><input className={inputClass} required value={profile.outputFormat} onChange={(e) => set("outputFormat", e.target.value)} /></Field>
      <fieldset><legend className="mb-2 text-sm font-medium">Skills</legend>
        <div className="grid gap-2 sm:grid-cols-2">{config.skills.map((item) => <label key={item.id} className="flex items-center gap-2 text-sm text-mute">
          <input type="checkbox" checked={profile.skills.includes(item.id)} onChange={(e) => set("skills", toggle(profile.skills, item.id, e.target.checked))} />{item.name}
        </label>)}</div>
      </fieldset>
      <fieldset><legend className="mb-2 text-sm font-medium">Tool permissions</legend>
        {(Object.entries(config.tools) as [ToolId, Catalog[ToolId]][]).map(([id, tool]) => <div key={id} className="flex flex-wrap justify-between gap-2 border-t border-line py-2 text-sm text-mute">
          <label className="flex items-center gap-2"><input type="checkbox" checked={profile.allowedTools.includes(id)} onChange={(e) => {
            set("allowedTools", toggle(profile.allowedTools, id, e.target.checked));
            if (!e.target.checked) set("preapproved", toggle(profile.preapproved, id, false));
          }} />{tool.label}</label>
          {tool.access === "read" && <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!profile.allowedTools.includes(id)} checked={profile.preapproved.includes(id)} onChange={(e) => set("preapproved", toggle(profile.preapproved, id, e.target.checked))} />Pre-approve</label>}
          {tool.access === "write" && <span className="text-xs text-warn">Approval required</span>}
        </div>)}
      </fieldset>
      <label className="flex items-center gap-2 text-sm text-mute"><input type="checkbox" checked={Boolean(profile.disabled)} onChange={(e) => set("disabled", e.target.checked)} />Exclude from Workforce runs</label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary">Save profile</Button>
        <Button type="button" onClick={async () => { if (await send({ action: "clone-agent", id: bot.id })) await refresh(); }}>Clone agent</Button>
        {saved && <span role="status" className="text-xs text-ok">Saved</span>}
      </div>
    </form>
  );
}

export function AgentManager({ bots, rooms, config, send, refresh, open, roomId }: {
  bots: Bot[]; rooms: Room[]; config: Config; send: Send; refresh: () => Promise<void>; open: (id: string) => void; roomId?: string;
}) {
  const [agent, setAgent] = useState(bots[0]?.id);
  const [description, setDescription] = useState("");
  const [room, setRoom] = useState(roomId || "");
  const [mode, setMode] = useState<RunMode>("mock");
  const [busy, setBusy] = useState(false);
  const bot = bots.find((item) => item.id === agent);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="space-y-4">
        <form className={`${card} space-y-3`} onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try {
            const result = await send<{ bot: Bot }>({ action: "agent", description, roomId: room || undefined, mode });
            if (result) { await refresh(); setAgent(result.bot.id); setDescription(""); }
          } finally { setBusy(false); }
        }}>
          <h2 className={heading}>Create an agent</h2>
          <Field label="Describe the role"><textarea className={inputClass} rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Create an agent named Cedar to review sales funnels and conversion by region." required maxLength={2500} /></Field>
          <Field label="Add to room"><select className={inputClass} value={room} onChange={(e) => setRoom(e.target.value)}><option value="">Choose later</option>{rooms.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Profile generation"><select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as RunMode)}><option value="mock">Local template</option><option value="live">Live model</option></select></Field>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create agent"}</Button>
        </form>
        <div className={`${card} space-y-2`}>
          <h2 className={heading}>Roster</h2>
          {bots.map((item) => <button key={item.id} onClick={() => setAgent(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-hover ${item.id === agent ? "bg-raised-2" : ""}`}>
            <BotAvatar bot={item} size={29} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name} <span className="text-xs font-normal text-mute">{item.title}</span></span>
            {item.workforce?.disabled && <Badge>Disabled</Badge>}
          </button>)}
        </div>
      </div>
      {bot && <AgentEditor key={bot.id} bot={bot} config={config} send={send} refresh={refresh} open={() => open(bot.id)} />}
    </div>
  );
}

export function Models({ config, send }: { config: Config; send: Send }) {
  const [model, setModel] = useState(config.settings);
  const [saved, setSaved] = useState(false);
  return (
    <form className={`${card} max-w-3xl space-y-4`} onSubmit={async (e) => { e.preventDefault(); setSaved(Boolean(await send({ action: "providers", ...model }))); }}>
      <h2 className={heading}>Model routing</h2>
      <div className="flex flex-wrap gap-2">{config.providers.map((provider) => <Badge key={provider.id}>{`${provider.id} · ${provider.ready ? "available to configure" : "key required"}`}</Badge>)}</div>
      {([
        ["planning", "Planning model", "Defaults to the primary model."],
        ["defaultModel", "Primary worker model", "Use provider:model. Example local:qwen3."],
        ["fallback", "Fallback model", "Used when the selected provider call fails."],
      ] as const).map(([id, label, hint]) => <Field key={id} label={label} hint={hint}><input className={inputClass} value={model[id]} onChange={(e) => { setSaved(false); setModel({ ...model, [id]: e.target.value }); }} /></Field>)}
      <Field label="Maximum output tokens per call"><input className={inputClass} type="number" min={256} max={5000} value={model.maxOutputTokens} onChange={(e) => setModel({ ...model, maxOutputTokens: Number(e.target.value) })} required /></Field>
      <Button type="submit" variant="primary">Save routing</Button>
      {saved && <span role="status" className="ml-2 text-xs text-ok">Saved</span>}
    </form>
  );
}

export function CatalogSettings({ config, send }: { config: Config; send: Send }) {
  const [tools, setTools] = useState(config.disabled);
  const [skills, setSkills] = useState(config.disabledSkills);
  const [saved, setSaved] = useState(false);
  return (
    <form className={`${card} space-y-4`} onSubmit={async (e) => { e.preventDefault(); setSaved(Boolean(await send({ action: "catalog", disabled: tools, skills }))); }}>
      <h2 className={heading}>Skills & tools</h2>
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        <fieldset><legend className="mb-2 text-sm font-medium">Enabled skills</legend>
          {config.skills.map((skill) => <label key={skill.id} className="flex gap-2 border-t border-line py-2 text-sm">
            <input type="checkbox" checked={!skills.includes(skill.id)} onChange={(e) => { setSaved(false); setSkills(toggle(skills, skill.id, !e.target.checked)); }} />{skill.name}
          </label>)}
        </fieldset>
        <fieldset><legend className="mb-2 text-sm font-medium">Available tools</legend>
          {(Object.entries(config.tools) as [ToolId, Catalog[ToolId]][]).map(([id, tool]) => <label key={id} className="flex items-start gap-2 border-t border-line py-2 text-sm">
            <input type="checkbox" className="mt-1" checked={!tools.includes(id)} onChange={(e) => { setSaved(false); setTools(toggle(tools, id, !e.target.checked)); }} />
            <span>{tool.label}<span className="block text-xs text-mute">{tool.description}</span></span>
          </label>)}
        </fieldset>
      </div>
      <Button type="submit" variant="primary">Save catalog</Button>
      {saved && <span role="status" className="ml-2 text-xs text-ok">Saved</span>}
    </form>
  );
}

export function Integrations({ config, send, manage }: { config: Config; send: Send; manage: () => void }) {
  const [results, setResults] = useState<Record<string, TaskOutput>>({});
  const [testing, setTesting] = useState("");
  return <div className="space-y-4">
    <div className={`${card} flex flex-wrap items-center justify-between gap-3`}><h2 className={heading}>Workforce integrations</h2>
      <Button size="sm" onClick={manage}>Manage connected apps & MCP servers</Button></div>
    <div className="grid gap-3 lg:grid-cols-2">{config.integrations.map((item) => <section key={item.id} className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{item.name}</h3><Badge>{results[item.id] ? "LIVE" : item.ready ? "Ready to test" : "Credentials required"}</Badge></div>
      <p className="text-sm text-mute">{item.scopes}</p>
      <Button size="sm" disabled={!item.ready || Boolean(testing)} onClick={async () => {
        setTesting(item.id);
        setResults((current) => { const next = { ...current }; delete next[item.id]; return next; });
        try {
          const result = await send<{ output: TaskOutput }>({ action: "integration-test", id: item.id });
          if (result) setResults((current) => ({ ...current, [item.id]: result.output }));
        } finally { setTesting(""); }
      }}>{testing === item.id ? "Testing…" : "Test live connection"}</Button>
      {results[item.id] && <Output output={results[item.id]} />}
    </section>)}</div>
    <section className={card}>
      <h3 className={heading}>Execution modes</h3>
      <table className="mt-3 w-full text-left text-sm">
        <thead><tr className="border-b border-line text-mute"><th className="py-2">Feature</th><th>Live run</th><th>Simulated run</th></tr></thead>
        <tbody>
          <tr className="border-b border-line"><td className="py-2">Agent responses</td><td><Badge>LIVE</Badge></td><td><Badge>SIMULATED</Badge></td></tr>
          <tr className="border-b border-line"><td className="py-2">External tools</td><td><Badge>LIVE</Badge></td><td><Badge>SIMULATED</Badge></td></tr>
          <tr><td className="py-2">Spreadsheet calculations</td><td><Badge>LOCAL</Badge></td><td><Badge>LOCAL</Badge></td></tr>
        </tbody>
      </table>
    </section>
  </div>;
}
