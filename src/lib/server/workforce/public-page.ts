import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { BlockList, isIP } from "node:net";
import { load } from "cheerio";
import { InputError } from "../errors";

const privateNetworks = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) privateNetworks.addSubnet(address, bits, "ipv4");

const maxBytes = 2_000_000;
const pageHost = (hostname: string) => hostname.toLowerCase().replace(/^www\./, "");

async function read(url: URL, signal: AbortSignal): Promise<{ html: string } | { redirect: string }> {
  if (url.protocol !== "https:" || url.port || url.username || url.password
    || isIP(url.hostname) || !/^[a-z0-9.-]+\.[a-z0-9-]+$/i.test(url.hostname)) {
    throw new InputError("Public page reads require a public HTTPS hostname on port 443.");
  }
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => privateNetworks.check(address, "ipv4"))) {
    throw new InputError("The source resolved to a private or reserved network.");
  }

  // Pin the validated address while retaining the hostname for TLS and HTTP.
  return new Promise((resolve, reject) => {
    const request = get(url, {
      agent: false, family: 4, signal,
      lookup: (_hostname, _options, callback) => callback(null, addresses[0].address, 4),
      headers: {
        Accept: "text/html, application/xhtml+xml, text/plain",
        "Accept-Encoding": "identity",
        "User-Agent": "OpenCrewBot/2.0 (public source reader)",
      },
    }, (response) => {
      response.on("error", reject);
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        resolve({ redirect: response.headers.location });
        response.destroy();
        return;
      }
      const contentType = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
      const encoding = response.headers["content-encoding"];
      if (response.statusCode !== 200 || !["text/html", "application/xhtml+xml", "text/plain"].includes(contentType ?? "")
        || (encoding && encoding !== "identity")) {
        reject(new InputError(`Public page did not return readable text (HTTP ${response.statusCode ?? "unknown"}).`));
        response.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > maxBytes) {
          response.destroy(new InputError("The public page exceeded the download limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
  });
}

export async function extractPublicPage(source: string, parentSignal: AbortSignal): Promise<string> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(15_000)]);
  let url = new URL(source);
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await read(url, signal);
    if ("redirect" in result) {
      const next = new URL(result.redirect, url);
      if (pageHost(next.hostname) !== pageHost(url.hostname) || next.search || next.hash) {
        throw new InputError("The source redirects to a different site or adds query parameters. Use the final public URL.");
      }
      url = next;
      continue;
    }
    const $ = load(result.html);
    const title = $("title").first().text().replace(/\s+/g, " ").trim().slice(0, 160) || url.hostname;
    $("script,style,noscript,svg,header,nav,footer,aside,form,iframe,[hidden]").remove();
    const root = $("main, article, [role=main]").first();
    const content = root.length ? root : $("body");
    content.find("h1,h2,h3,h4,p,li,td,th,br,section").append("\n");
    const lines = content.text().split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    const unique = [...new Set(lines)];
    if (unique.join(" ").length < 45) throw new InputError("The page contained no readable public text.");
    const excerpt = unique.join("\n").slice(0, 6500);
    const pricing = lines.flatMap((line, index) => {
      const amount = /(?:₹|\bINR\s*|\bRs\.?\s*)\d[\d,]*/i.test(line) || /^\d{1,3}(?:,\d{3})+(?:\s+onwards)?$/i.test(line);
      if (!amount || line.length > 170) return [];
      const context = lines.slice(Math.max(0, index - 3), index + 1).map((part) => part.slice(0, 120));
      return [context.join(" · ")];
    });
    const priceExcerpt = [...new Set(pricing)].slice(0, 12).join("\n").slice(0, 1400);
    return `### ${title}\nSource: ${url.href}\nRetrieved: ${new Date().toISOString()}\n\n${priceExcerpt ? `Lines near possible published prices:\n${priceExcerpt}\n\n` : ""}${excerpt}`;
  }
  throw new InputError("The source redirected too many times.");
}
