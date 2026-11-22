import type { ProviderSettings, Usage } from "@/lib/shared/workforce";
import { getSetting } from "../db";
import { InputError } from "../errors";
import { redactSecrets } from "../memory-files";
import { DEFAULT_MODEL } from "../models";

export const providerSettingKey = "workforce.providers";
const defaults: ProviderSettings = {
  planning: process.env.WORKFORCE_PLAN_MODEL || "",
  defaultModel: process.env.WORKFORCE_MODEL || (process.env.NEBIUS_API_KEY ? `nebius:${DEFAULT_MODEL}` : ""),
  fallback: process.env.WORKFORCE_FALLBACK_MODEL || "",
  maxOutputTokens: 3000,
};

export const settings = async () => (await getSetting<ProviderSettings>(providerSettingKey)) ?? defaults;

function endpoints() {
  return {
    nebius: { base: "https://api.tokenfactory.nebius.com/v1", key: process.env.NEBIUS_API_KEY },
    openai: { base: process.env.WORKFORCE_OPENAI_URL || "https://api.openai.com/v1", key: process.env.OPENAI_API_KEY },
    local: { base: process.env.WORKFORCE_LOCAL_URL || "http://127.0.0.1:11434/v1", key: process.env.WORKFORCE_LOCAL_KEY },
  };
}

export function providers() {
  const available = endpoints();
  return [
    { id: "nebius", ready: Boolean(available.nebius.key) },
    { id: "openai", ready: Boolean(available.openai.key || process.env.WORKFORCE_OPENAI_URL) },
    { id: "local", ready: true },
  ];
}

export function validateModel(id: string) {
  if (id && (!/^(nebius|openai|local):[a-zA-Z0-9_./:@-]{1,140}$/.test(id) || redactSecrets(id) !== id)) {
    throw new InputError("Use a model ID like local:qwen3, openai:MODEL or nebius:ORGANIZATION/MODEL.");
  }
}

function price(id: string, input: number, output: number): number | null {
  try {
    const rates = JSON.parse(process.env.WORKFORCE_PRICES || "{}")[id];
    if (Array.isArray(rates) && rates.length === 2 && rates.every((rate) => Number.isFinite(rate) && rate >= 0)) {
      return (input * rates[0] + output * rates[1]) / 1_000_000;
    }
  } catch {
    // Invalid rate configuration does not turn unknown cost into a zero estimate.
  }
  return id.startsWith("local:") ? 0 : null;
}

async function complete(id: string, system: string, prompt: string, max: number, signal: AbortSignal, schema?: object) {
  validateModel(id);
  const index = id.indexOf(":");
  const provider = id.slice(0, index) as keyof ReturnType<typeof endpoints>;
  const model = id.slice(index + 1);
  const { base, key } = endpoints()[provider];
  if (!providers().some((entry) => entry.id === provider && entry.ready)) throw new Error(`${provider} is not configured.`);
  const url = new URL(`${base.replace(/\/+$/, "")}/chat/completions`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Model endpoints require HTTPS or loopback HTTP.");
  }
  const tokenLimit = url.hostname === "api.openai.com" ? { max_completion_tokens: max } : { max_tokens: max };
  const format = provider === "local" && schema
    ? { response_format: { type: "json_schema", json_schema: { name: "workforce_result", schema } } }
    : {};
  const response = await fetch(url, {
    method: "POST", redirect: "error", signal,
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, ...tokenLimit, ...format, messages: [{ role: "system", content: system.slice(0, 18_000) }, { role: "user", content: prompt.slice(0, 60_000) }] }),
  });
  if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}.`);
  const data = await response.json();
  const content: unknown = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error(`${provider} returned an empty response.`);
  const input = Number(data.usage?.prompt_tokens) || 0;
  const output = Number(data.usage?.completion_tokens) || 0;
  const usage: Usage = { model: id, input, output, costUsd: data.usage ? price(id, input, output) : null };
  return { text: redactSecrets(content).slice(0, 24_000), usage };
}

export async function generate(preferred: string, config: ProviderSettings, system: string, prompt: string, signal: AbortSignal, schema?: object) {
  const candidates = [...new Set([preferred || config.defaultModel, config.fallback].filter(Boolean))];
  if (!candidates.length) throw new InputError("Configure a Workforce model before running in Live mode.");
  const errors: string[] = [];
  for (const id of candidates) {
    signal.throwIfAborted();
    try {
      const timeout = id.startsWith("local:") ? 240_000 : 24_000;
      return await complete(id, system, prompt, config.maxOutputTokens, AbortSignal.any([signal, AbortSignal.timeout(timeout)]), schema);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      errors.push(/^(nebius|openai|local) (returned|is not configured)/.test(message) ? message : `${id} could not complete the request.`);
    }
  }
  throw new Error(errors.join(" "));
}
