import { load } from "cheerio";
import type { Snapshot, Table } from "./types";
export function numeric(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/,/g, "")
    .replace(/^(?:Rs\.?|PKR)\s*/i, "")
    .replace(/%$/, "");
  if (!s || !/^\(?[+-]?\d+(?:\.\d+)?\)?$/.test(s)) return null;
  const n = Number(s.replace(/[()]/g, ""));
  return Number.isFinite(n) ? (s.startsWith("(") ? -n : n) : null;
}
export async function fetchText(url: string, init: RequestInit = {}) {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    ![
      "dps.psx.com.pk",
      "www.psx.com.pk",
      "psx.com.pk",
      "www.youtube.com",
      "youtube.com",
      "investkaar.com",
      "scstrade.com",
      "www.scstrade.com",
    ].includes(u.hostname)
  )
    throw new Error("Unsupported source host");
  const response = await fetch(u, {
    ...init,
    headers: {
      "User-Agent": "PSXResearchDesk/0.1 (personal research)",
      ...init.headers,
    },
    redirect: "error",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  if (Number(response.headers.get("content-length") || 0) > 3_000_000)
    throw new Error("Source exceeds 3 MB limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty source response");
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 3_000_000) throw new Error("Source exceeds 3 MB limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function parsePsx(html: string, symbol: string): Snapshot {
  const $ = load(html);
  const title = $("title").text();
  if (!title.startsWith(`${symbol} -`))
    throw new Error(`PSX did not validate symbol ${symbol}`);
  const name = $(".quote__name")
    .clone()
    .children()
    .remove()
    .end()
    .text()
    .trim();
  const price = numeric($(".quote__close").first().text());
  if (!name || price === null || price <= 0)
    throw new Error("Company quote layout changed or price unavailable");
  const stats = new Map<string, number | null>();
  $('.tabs__panel[data-name="REG"] .stats_item').each((_, el) => {
    const label = $(el).find(".stats_label").text().trim();
    stats.set(
      label,
      numeric(
        $(el).find(".stats_value").clone().children().remove().end().text(),
      ),
    );
  });
  function table(selector: string, unit: string): Table {
    const t = $(selector).first();
    const periods = t
      .find("thead tr")
      .first()
      .find("th")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const rows = t
      .find("tbody tr")
      .map((_, el) => {
        const cells = $(el).find("td");
        return {
          label: cells.first().text().trim(),
          values: cells
            .slice(1)
            .map((__, c) => ({ value: numeric($(c).text()) }))
            .get()
            .map((c) => c.value),
        };
      })
      .get();
    return {
      periods,
      rows,
      unit,
      basis:
        "PSX standardized company summary; verify issuer filing consolidation basis",
    };
  }
  const annual = table(
    '#financials .tabs__panel[data-name="Annual"] table',
    "PKR thousands, except EPS (PKR/share)",
  );
  const quarterly = table(
    '#financials .tabs__panel[data-name="Quarterly"] table',
    "PKR thousands, except EPS (PKR/share)",
  );
  const ratios = table("#ratios table", "As labeled per row");
  const announcements: { date: string; title: string; url: string }[] = [];
  $("#announcements tbody tr").each((_, el) => {
    const cells = $(el).find("td");
    const href = $(el).find('a[href$=".pdf"]').attr("href");
    if (href?.startsWith("/download/document/"))
      announcements.push({
        date: cells.eq(0).text().trim(),
        title: cells.eq(1).text().trim(),
        url: new URL(href, "https://dps.psx.com.pk").href,
      });
  });
  return {
    name,
    sector: $(".quote__sector").text().trim(),
    price,
    change: numeric($(".change__percent").first().text().replace(/[()]/g, "")),
    priceDate: $(".quote__date")
      .first()
      .text()
      .replace(/^\^?\s*As of\s*/, ""),
    pe: stats.get("P/E Ratio (TTM) **") ?? null,
    volume: stats.get("Volume") ?? null,
    priceReturn: stats.get("1-Year Change * ^") ?? null,
    annual,
    quarterly,
    ratios,
    payouts: parsePayouts($("#payouts").html() || ""),
    announcements,
    shariah: { status: "unverified", date: null, url: null },
    notes: [
      "Price returns exclude payouts; PSX historical prices reflect splits.",
      "P/E is based on unconsolidated financials. Other financial summaries may be standardized.",
      "Debt, return on equity and dividend yield are not inferred from missing data.",
    ],
  };
}
export function parsePayouts(html: string) {
  const $ = load(html);
  return $("tbody tr")
    .map((_, el) => {
      const cells = $(el)
        .find("td")
        .map((__, c) => $(c).text().replace(/\s+/g, " ").trim())
        .get();
      return { date: cells[0] || "", description: cells.slice(1).join(" | ") };
    })
    .get()
    .filter((x) => x.date && x.description);
}
export async function collectPsx(symbol: string) {
  const snap = parsePsx(
    await fetchText(`https://dps.psx.com.pk/company/${symbol}`),
    symbol,
  );
  try {
    snap.payouts = parsePayouts(
      await fetchText("https://dps.psx.com.pk/company/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ symbol }).toString(),
      }),
    );
  } catch (e) {
    snap.notes.push(
      `Payout retrieval unavailable: ${e instanceof Error ? e.message : "source failure"}`,
    );
  }
  return snap;
}
export function parseFeed(xml: string) {
  const $ = load(xml, { xmlMode: true });
  return $("entry")
    .map((_, el) => ({
      id: $(el).find("yt\\:videoId").text(),
      title: $(el).find("title").text(),
      published_at: $(el).find("published").text(),
      url: $(el).find("link").attr("href") || "",
    }))
    .get()
    .filter((x) => /^[-\w]{11}$/.test(x.id));
}
