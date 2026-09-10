import { getJson, pool } from '../lib/http.js';
import * as cache from '../lib/cache.js';
import { ok, fail } from '../lib/result.js';

const ID = 'markets';

/**
 * Two providers behind one interface.
 *
 * CNBC is primary because it answers for all 15 instruments in a SINGLE request,
 * which is what keeps us under rate limits. Yahoo needs one request per symbol and
 * started returning 429 during development after only a few dozen calls, so it is
 * demoted to a per-instrument fallback for whatever CNBC does not cover.
 */
export async function fetchMarkets(cfg) {
  const { groups, instruments } = cfg.markets;
  const ids = groups.flatMap((g) => g.symbols);

  let quotes = new Map();
  let provider = null;

  try {
    quotes = await fromCnbc(ids, instruments, cfg);
    provider = 'CNBC';
  } catch { /* fall through to per-instrument recovery */ }

  // Anything still missing: try Yahoo, then a stale cache entry.
  const missing = ids.filter((id) => !quotes.has(id));
  if (missing.length) {
    const recovered = await pool(missing, 3, 150, (id) => fromYahoo(id, instruments[id], cfg));
    for (const q of recovered) if (q) { quotes.set(q.id, q); if (!provider) provider = 'Yahoo'; }
  }
  for (const id of ids.filter((i) => !quotes.has(i))) {
    const stale = await cache.readStale(`market_${id}`, cfg.cache.marketsMaxStaleHours);
    if (stale) quotes.set(id, { ...stale.data, fromCache: true, cachedAt: stale.fetchedAt });
  }

  const live = ids.filter((id) => quotes.get(id)?.price != null).length;
  if (live === 0) return fail(ID, new Error('no market data from CNBC, Yahoo or cache'));

  return ok(ID, {
    provider: provider ?? 'cache',
    total: ids.length,
    live,
    degraded: live < ids.length,
    asOf: latestSession([...quotes.values()]),
    groups: groups.map((g) => ({
      label: g.label,
      rows: g.symbols.map((id) => ({
        id,
        name: instruments[id]?.name ?? id,
        digits: instruments[id]?.digits,
        ...(quotes.get(id) ?? { price: null, changePct: null, error: 'not available' }),
      })),
    })),
  });
}

/* ---------------------------------- CNBC ---------------------------------- */

async function fromCnbc(ids, instruments, cfg) {
  const symbols = ids.map((id) => instruments[id]?.cnbc).filter(Boolean);
  const url = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol'
    + `?symbols=${encodeURIComponent(symbols.join('|'))}`
    + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json';

  const raw = await getJson(url, { timeoutMs: cfg.timeouts.quoteMs + 3000 });
  let list = raw?.FormattedQuoteResult?.FormattedQuote ?? [];
  if (!Array.isArray(list)) list = [list];

  const bySymbol = new Map(list.map((q) => [q.symbol, q]));
  const out = new Map();
  for (const id of ids) {
    const q = bySymbol.get(instruments[id]?.cnbc);
    const price = parseNum(q?.last);
    if (price == null) continue;
    const quote = {
      id,
      price,
      changePct: parseNum(q?.change_pct),
      change: parseNum(q?.change),
      currency: q?.currencyCode ?? null,
      marketTime: parseTime(q?.last_time ?? q?.last_timedate),
      source: 'CNBC',
      fromCache: false,
    };
    out.set(id, quote);
    await cache.write(`market_${id}`, quote);
  }
  if (out.size === 0) throw new Error('CNBC returned no usable quotes');
  return out;
}

/* --------------------------------- Yahoo ---------------------------------- */

async function fromYahoo(id, instrument, cfg) {
  if (!instrument?.yahoo) return null;
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
    + `${encodeURIComponent(instrument.yahoo)}?range=5d&interval=1d`;
  try {
    // range=5d survives market holidays and supplies the previous close for free.
    const raw = await getJson(url, { timeoutMs: cfg.timeouts.quoteMs, retries: 0 });
    const r = raw?.chart?.result?.[0];
    const meta = r?.meta ?? {};
    let price = meta.regularMarketPrice;
    let prev = meta.chartPreviousClose ?? meta.previousClose;
    if (price == null || prev == null) {
      const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter((v) => v != null);
      price ??= closes.at(-1);
      prev ??= closes.at(-2);
    }
    if (price == null) return null;
    const change = prev != null ? price - prev : null;
    const quote = {
      id, price, change,
      changePct: change != null && prev ? (change / prev) * 100 : null,
      currency: meta.currency ?? null,
      marketTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
      source: 'Yahoo',
      fromCache: false,
    };
    await cache.write(`market_${id}`, quote);
    return quote;
  } catch { return null; }
}

/* --------------------------------- helpers -------------------------------- */

function parseNum(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[,%\s+]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** CNBC mixes a bare date for closed US sessions with a full ISO stamp for open ones. */
function parseTime(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** The newest session stamp across all quotes, so a weekend digest labels itself honestly. */
function latestSession(quotes) {
  const times = quotes.map((q) => q.marketTime).filter(Boolean);
  return times.length ? Math.max(...times) : null;
}
