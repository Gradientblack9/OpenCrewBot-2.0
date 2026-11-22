import type { TaskOutput } from "@/lib/shared/workforce";
import { InputError } from "../errors";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (char === '"' && (quoted || !cell)) {
      quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      row.push(cell.trim());
      cell = "";
      if (char !== ",") {
        if (char === "\r" && text[i + 1] === "\n") i++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else {
      cell += char;
    }
  }
  if (quoted) throw new InputError("The CSV contains an unclosed quoted value.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const funnel = [
  ["Leads", /^(leads?|inquiries|prospects)$/i],
  ["Qualified", /^(qualified|mqls?|sqls?)$/i],
  ["Appointments", /^(appointments?|calls|consultations)$/i],
  ["Applications", /^(applications?|applied)$/i],
  ["Sales", /^(sales|wins|won|enrollm?ents?|conversions|closed won)$/i],
] as const;
const formatted = (value: number) => Number(value.toFixed(2)).toLocaleString("en-US");
const tableCell = (value: string) => value.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
const asNumber = (value: string) => {
  const decoded = value.replace(/^[$₹€£]\s*/, "").replace(/,/g, "");
  return /^[-+]?\d+(\.\d+)?$/.test(decoded) ? Number(decoded) : NaN;
};

export function analyzeCsv(name: string, text: string): TaskOutput {
  const [head, ...rows] = parseCsv(text);
  if (!head?.length || !rows.length || head.length > 60 || rows.length > 12_000) {
    throw new InputError("Attach a CSV with headers and 1–12,000 data rows, up to 60 columns.");
  }
  if (rows.some((row) => row.length !== head.length)) throw new InputError("The CSV has rows with a different width from its headers.");
  const headers = head.map((value) => value.replace(/[_-]/g, " ").trim());
  const stages = funnel.map(([label, pattern]) => ({ label, index: headers.findIndex((column) => pattern.test(column)) })).filter((item) => item.index >= 0);
  const revenue = headers.findIndex((column) => /^(revenue|amount|sales value|income|bookings)(\b|$)/i.test(column));
  const metrics = [...stages, ...(revenue >= 0 ? [{ label: "Revenue", index: revenue }] : [])];
  if (!metrics.length) {
    headers.forEach((label, index) => {
      const values = rows.map((row) => row[index]).filter(Boolean);
      if (values.length && values.every((value) => Number.isFinite(asNumber(value)))) metrics.push({ label, index });
    });
  }
  if (!metrics.length) throw new InputError("No numeric columns were found in the CSV.");
  const segment = headers.findIndex((value) => /^(segment|product|channel|source|region|team|market|category|cohort)(\b|$)/i.test(value));
  const buckets = new Map<string, number[]>();
  const totals = metrics.map(() => 0);
  let invalid = 0;
  for (const row of rows) {
    let label = segment < 0 ? "All rows" : row[segment] || "Unspecified";
    if (!buckets.has(label) && buckets.size >= 29) label = "Other segments";
    const sum = buckets.get(label) ?? metrics.map(() => 0);
    metrics.forEach(({ index }, metric) => {
      const value = asNumber(row[index]);
      if (Number.isFinite(value)) {
        totals[metric] += value;
        sum[metric] += value;
      } else invalid++;
    });
    buckets.set(label, sum);
  }
  const rates = stages.slice(1).map(({ label }, i) => ({
    label: `${stages[i].label} → ${label}`, value: totals[i] > 0 ? totals[i + 1] / totals[i] : null,
  }));
  const observed = rates.filter((rate): rate is { label: string; value: number } => rate.value !== null);
  const bottleneck = [...observed].sort((a, b) => a.value - b.value)[0];
  const columns = [segment < 0 ? "Scope" : headers[segment], ...metrics.map((metric) => metric.label)].map(tableCell);
  const cells = (label: string, values: number[]) => `| ${[tableCell(label), ...values.map(formatted)].join(" | ")} |`;
  const conversions = stages.length >= 2 ? Array.from(buckets, ([label, sums]) => {
    const initial = sums[0];
    const final = sums[stages.length - 1];
    return `- **${tableCell(label)}**: ${initial > 0 ? `${formatted(final / initial * 100)}%` : "undefined"} from ${stages[0].label.toLowerCase()} to ${stages.at(-1)!.label.toLowerCase()}${revenue >= 0 && totals.at(-1)! > 0 ? `, ${formatted(sums.at(-1)! / totals.at(-1)! * 100)}% of recorded revenue` : ""}.`;
  }).join("\n") : "";
  const findings = bottleneck
    ? `Lowest observed transition: **${bottleneck.label}** at **${formatted(bottleneck.value * 100)}%**. Compare this step across segments before testing an intervention.`
    : "The file does not have two funnel stages with a positive denominator.";
  const markdown = [
    `### ${tableCell(name)}\nCalculated from ${rows.length} rows. Invalid or blank numeric cells excluded: ${invalid}.`,
    [`| ${columns.join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`,
      ...Array.from(buckets, ([label, values]) => cells(label, values)), cells("Total", totals)].join("\n"),
    rates.map((rate) => `- ${rate.label}: ${rate.value === null ? "undefined" : `${formatted(rate.value * 100)}%`}`).join("\n"),
    conversions && `### Segment performance\n\n${conversions}`,
    findings,
  ].filter(Boolean).join("\n\n");
  return { markdown, mode: "LOCAL", chart: stages.length
    ? stages.map((stage, index) => ({ label: stage.label, value: totals[index] }))
    : metrics.slice(0, 10).map((metric, index) => ({ label: metric.label, value: totals[index] })) };
}
