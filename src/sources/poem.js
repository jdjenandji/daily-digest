import { getJson } from '../lib/http.js';
import * as cache from '../lib/cache.js';
import { ok, fail } from '../lib/result.js';
import { dayBounds } from '../config.js';

const ID = 'poem';
const API = 'https://poetrydb.org';

/**
 * A poem for the day, from PoetryDB.
 *
 * Not the Poetry Foundation, which was the original ask: every one of their endpoints
 * sits behind a Cloudflare bot challenge that returns 403 to any non-browser client,
 * and their Poem of the Day rotates contemporary work that is still in copyright.
 * PoetryDB is an open API built to be consumed programmatically and holds only
 * public-domain poets, so the full text can be printed without reproducing anything
 * still owned.
 *
 * The choice is keyed to the date, so it is stable all day and turns over at midnight
 * rather than changing on every Generate.
 */
export async function fetchPoem(cfg) {
  const p = cfg.poem ?? {};
  if (p.enabled === false) return ok(ID, null);

  const tz = cfg.location.timezone;
  const { ymd } = dayBounds(tz);
  // PoetryDB has no range query, so pick a length first, then a poem of that length.
  const lengths = (p.lineCounts ?? [8, 10, 12, 14])
    .filter((n) => n <= (p.maxLines ?? 14));
  if (!lengths.length) return fail(ID, new Error('poem.lineCounts and poem.maxLines leave no options'));

  const wanted = lengths[hash(ymd) % lengths.length];
  const key = `poem_${ymd}_${wanted}`;

  const cached = await cache.read(key);
  if (cached?.data) return ok(ID, cached.data, { fetchedAt: cached.fetchedAt });

  try {
    const pool = await getJson(`${API}/linecount/${wanted}/title,author,lines,linecount`,
      { timeoutMs: p.timeoutMs ?? 8000 });
    if (!Array.isArray(pool) || !pool.length) throw new Error(`no poems of ${wanted} lines`);

    const chosen = pool[hash(`${ymd}:${wanted}`) % pool.length];
    const data = {
      title: (chosen.title ?? '').trim(),
      author: (chosen.author ?? '').trim(),
      // Keep blank lines: they are stanza breaks, and dropping them changes the poem.
      lines: (chosen.lines ?? []).map((l) => l.replace(/\s+$/, '')),
      source: 'PoetryDB',
    };
    if (!data.title || !data.lines.length) throw new Error('poem record was incomplete');

    await cache.write(key, data);
    return ok(ID, data);
  } catch (err) {
    // Yesterday's poem is a perfectly good poem, unlike yesterday's calendar.
    const stale = await cache.readStale(key, 24)
      ?? await newestCachedPoem(lengths, p.maxStaleDays ?? 7);
    if (stale) return ok(ID, stale.data, { fromCache: true, fetchedAt: stale.fetchedAt });
    return fail(ID, err);
  }
}

/** Fall back to any recent day's poem rather than leaving the section empty. */
async function newestCachedPoem(lengths, days) {
  const now = new Date();
  for (let i = 1; i <= days; i++) {
    const ymd = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    for (const n of lengths) {
      const entry = await cache.read(`poem_${ymd}_${n}`);
      if (entry?.data) return entry;
    }
  }
  return null;
}

/** Stable, seeded only by the date string. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
