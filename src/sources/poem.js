import { getJson } from '../lib/http.js';
import * as cache from '../lib/cache.js';
import { ok, fail } from '../lib/result.js';
import { dayBounds } from '../config.js';

const ID = 'poem';
const API = 'https://poetrydb.org';
const WIKI = 'https://en.wikipedia.org/api/rest_v1/page/summary';

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
  //
  // Note these are PoetryDB's own linecount, which counts lines of verse and excludes
  // the blank lines it uses for stanza breaks. A poem listed at 40 therefore renders
  // taller than 40 lines: today's 40-line Thoreau came back with 48 line elements and
  // 8 stanza breaks. The cap bounds the verse, not the printed height.
  const lengths = (p.lineCounts ?? [8, 10, 12, 14])
    .filter((n) => n <= (p.maxLines ?? 14));
  if (!lengths.length) return fail(ID, new Error('poem.lineCounts and poem.maxLines leave no options'));

  // With an author pinned, the pool is that poet's work rather than everything of a
  // given length, so the available lengths come from their own catalogue.
  const author = (p.author ?? '').trim();
  const available = author ? await authorLengths(author, lengths, p) : lengths;
  if (!available.length) {
    return fail(ID, new Error(author
      ? `${author} has no poems within ${p.maxLines ?? 24} lines`
      : 'no usable poem lengths'));
  }

  const wanted = available[hash(ymd) % available.length];
  const key = `poem_${ymd}_${author || 'any'}_${wanted}`;

  const cached = await cache.read(key);
  if (cached?.data) return ok(ID, cached.data, { fetchedAt: cached.fetchedAt });

  try {
    const path = author
      ? `author,linecount/${encodeURIComponent(author)};${wanted}`
      : `linecount/${wanted}`;
    const pool = await getJson(`${API}/${path}/title,author,lines,linecount`,
      { timeoutMs: p.timeoutMs ?? 8000 });
    // PoetryDB answers a miss with {status:404} rather than an empty array.
    if (!Array.isArray(pool) || !pool.length) {
      throw new Error(`no ${author || 'poems'} at ${wanted} lines`);
    }

    const chosen = pool[hash(`${ymd}:${wanted}`) % pool.length];
    const data = {
      title: (chosen.title ?? '').trim(),
      author: (chosen.author ?? '').trim(),
      // Keep blank lines: they are stanza breaks, and dropping them changes the poem.
      lines: (chosen.lines ?? []).map((l) => l.replace(/\s+$/, '')),
      source: 'PoetryDB',
    };
    if (!data.title || !data.lines.length) throw new Error('poem record was incomplete');

    // A note on the poet, if one can be had. Never fatal: a poem with no biography is
    // still a poem, so this failing must not cost the section.
    data.bio = await biography(data.author, p);

    await cache.write(key, data);
    return ok(ID, data);
  } catch (err) {
    // Yesterday's poem is a perfectly good poem, unlike yesterday's calendar.
    const stale = await cache.readStale(key, 24)
      ?? await newestCachedPoem(available, p.maxStaleDays ?? 7, author || 'any');
    if (stale) return ok(ID, stale.data, { fromCache: true, fetchedAt: stale.fetchedAt });
    return fail(ID, err);
  }
}

/**
 * Which line counts this poet actually has, intersected with the configured lengths.
 * Cached for a day: the catalogue does not change hour to hour, and asking once beats
 * discovering by 404 that Byron wrote nothing of exactly eighteen lines.
 */
async function authorLengths(author, lengths, p) {
  const key = `poem_index_${author}`;
  const cached = await cache.readStale(key, 24);
  let counts = cached?.data;
  if (!counts) {
    const idx = await getJson(`${API}/author/${encodeURIComponent(author)}/title,linecount`,
      { timeoutMs: p.timeoutMs ?? 8000 });
    if (!Array.isArray(idx)) throw new Error(`no poems found for "${author}"`);
    counts = [...new Set(idx.map((x) => Number(x.linecount)).filter(Number.isFinite))];
    await cache.write(key, counts);
  }
  return lengths.filter((n) => counts.includes(n));
}

/**
 * A short biographical note from Wikipedia's summary endpoint.
 *
 * Trimmed to the first couple of sentences and attributed, since Wikipedia text is
 * CC BY-SA: this is a brief note pointing at the poet, not a reproduction of the article.
 * Returns null on anything unexpected, including disambiguation pages, which are not a
 * biography of anyone.
 */
async function biography(author, p) {
  if (!author || p.biography === false) return null;
  try {
    // PoetryDB's name is not always the article title: "George Gordon, Lord Byron" is
    // filed under "Lord Byron". biographyTitle overrides the lookup when they differ.
    const lookup = (p.biographyTitle || author).trim();
    const slug = encodeURIComponent(lookup.replace(/\s+/g, '_'));
    const d = await getJson(`${WIKI}/${slug}`, { timeoutMs: p.bioTimeoutMs ?? 6000, retries: 0 });
    if (d?.type && d.type !== 'standard') return null;
    const extract = (d?.extract ?? '').trim();
    if (!extract) return null;
    return {
      text: firstSentences(extract, p.bioMaxChars ?? 240),
      title: d.title ?? lookup,
      url: d?.content_urls?.desktop?.page ?? null,
      source: 'Wikipedia',
    };
  } catch { return null; }
}

/**
 * Keep whole sentences only, up to the budget.
 *
 * An earlier version cut at the nearest boundary above a fraction of the limit, which
 * rejected a perfectly good 79-character opening sentence for being "too short" and
 * ellipsised mid-clause instead. Taking complete sentences means the note always ends
 * on a full stop, and a short first sentence is a feature rather than a failure.
 */
function firstSentences(text, max) {
  if (text.length <= max) return text;
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*/g) ?? [];
  let out = '';
  for (const part of parts) {
    if ((out + part).trim().length > max) break;
    out += part;
  }
  out = out.trim();
  if (out) return out;
  // Not even one sentence fits: fall back to a word boundary.
  const cut = text.slice(0, max + 1);
  const sp = cut.lastIndexOf(' ');
  return `${cut.slice(0, sp > 0 ? sp : max).replace(/[,;:]$/, '')}…`;
}

/** Fall back to any recent day's poem rather than leaving the section empty. */
async function newestCachedPoem(lengths, days, author = 'any') {
  const now = new Date();
  for (let i = 1; i <= days; i++) {
    const ymd = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    for (const n of lengths) {
      const entry = await cache.read(`poem_${ymd}_${author}_${n}`);
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
