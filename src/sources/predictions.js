import { getJson } from '../lib/http.js';
import * as cache from '../lib/cache.js';
import { ok, fail } from '../lib/result.js';
import { clip } from '../lib/fmt.js';

const ID = 'predictions';
const API = 'https://gamma-api.polymarket.com/markets';
const CACHE_KEY = 'predictions_polymarket_top';

/** The most actively traded open Polymarket questions, ranked by 24-hour volume. */
export async function fetchPredictions(cfg) {
  const p = cfg.predictions ?? {};
  if (p.enabled === false) return ok(ID, null);

  const fresh = await cache.readFresh(CACHE_KEY, p.freshMinutes ?? 15);
  if (fresh?.data) return ok(ID, fresh.data, { fetchedAt: fresh.fetchedAt });

  try {
    const limit = p.limit ?? 3;
    const url = new URL(p.endpoint || API);
    url.searchParams.set('active', 'true');
    url.searchParams.set('closed', 'false');
    url.searchParams.set('limit', String(Math.max(limit, 10)));
    url.searchParams.set('order', 'volume24hr');
    url.searchParams.set('ascending', 'false');

    const payload = await getJson(url, { timeoutMs: p.timeoutMs ?? 8000 });
    const items = normalisePredictions(payload, limit);
    if (!items.length) throw new Error('Polymarket returned no usable active markets');

    const data = { items, source: 'Polymarket', asOf: Date.now() };
    await cache.write(CACHE_KEY, data);
    return ok(ID, data);
  } catch (err) {
    const stale = await cache.readStale(CACHE_KEY, p.maxStaleHours ?? 24);
    if (stale?.data) return ok(ID, stale.data, { fromCache: true, fetchedAt: stale.fetchedAt });
    return fail(ID, err);
  }
}

export function normalisePredictions(payload, limit = 3) {
  if (!Array.isArray(payload)) return [];
  return payload.map((market) => {
    const outcomes = arrayField(market?.outcomes);
    const prices = arrayField(market?.outcomePrices).map(Number);
    const yes = outcomes.findIndex((outcome) => String(outcome).toLowerCase() === 'yes');
    const index = yes >= 0 ? yes : prices.indexOf(Math.max(...prices.filter(Number.isFinite)));
    const probability = prices[index];
    const question = clip(String(market?.question ?? ''), 110);
    if (!question || index < 0 || !Number.isFinite(probability)) return null;
    return {
      question,
      outcome: outcomes[index] ?? '',
      probability: Math.max(0, Math.min(1, probability)),
      volume24h: Number(market?.volume24hr) || 0,
      url: market?.slug ? `https://polymarket.com/event/${market.slug}` : null,
    };
  }).filter(Boolean).slice(0, limit);
}

function arrayField(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
