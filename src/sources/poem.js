import { getJson } from '../lib/http.js';
import * as cache from '../lib/cache.js';
import { ok, fail } from '../lib/result.js';
import { dayBounds } from '../config.js';

const ID = 'poem';
const API = 'https://api.parse.bot/scraper/18773879-45ca-4c85-a458-3e9c4a4d59ca/get_poem_of_the_day';

/**
 * Poetry Foundation's Poem of the Day, returned by the configured Parse.bot scraper.
 * The daily cache makes repeated Generate clicks deterministic and provides a recent
 * poem if the scraper is temporarily unavailable.
 */
export async function fetchPoem(cfg) {
  const p = cfg.poem ?? {};
  if (p.enabled === false) return ok(ID, null);

  const apiKey = process.env.PARSE_BOT_API_KEY || p.apiKey;
  if (!apiKey) return fail(ID, new Error('set poem.apiKey or PARSE_BOT_API_KEY'));

  const { ymd } = dayBounds(cfg.location.timezone);
  const key = `poem_parsebot_${ymd}`;

  const cached = await cache.read(key);
  if (cached?.data) return ok(ID, cached.data, { fetchedAt: cached.fetchedAt });

  try {
    const payload = await getJson(p.endpoint || API, {
      timeoutMs: p.timeoutMs ?? 8000,
      headers: { 'X-API-Key': apiKey },
    });
    const data = normalisePoem(payload);

    await cache.write(key, data);
    return ok(ID, data);
  } catch (err) {
    const stale = await newestCachedPoem(ymd, p.maxStaleDays ?? 7);
    if (stale) return ok(ID, stale.data, { fromCache: true, fetchedAt: stale.fetchedAt });
    return fail(ID, err);
  }
}

/** Convert the scraper response to the renderer's deliberately small poem model. */
export function normalisePoem(payload) {
  if (payload?.status !== 'success' || !payload.data) {
    throw new Error('poem API did not return a successful record');
  }
  const raw = payload.data;
  const title = String(raw.title ?? '').trim();
  const authors = names(raw.authors);
  const text = String(raw.text ?? '').trim();
  if (!title || !authors.length || !text) throw new Error('poem record was incomplete');

  return {
    title,
    author: authors.join(', '),
    lines: poemLines(text),
    date: raw.date ?? null,
    source: 'Poetry Foundation',
    sourceUrl: raw.poem_url ?? null,
    translatedBy: names(raw.translated_by),
    epigraph: cleanOptional(raw.epigraph),
    editorNote: cleanOptional(raw.editors_note),
    credit: cleanOptional(raw.copyright_credit),
  };
}

function names(value) {
  return Array.isArray(value)
    ? value.map((x) => String(x?.name ?? '').trim()).filter(Boolean)
    : [];
}

function cleanOptional(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/**
 * Parse.bot currently doubles every newline in the plain-text field: two newlines are
 * a verse break and four are a stanza break. Detect that representation while still
 * accepting conventional one-newline text if the scraper changes later.
 */
export function poemLines(value) {
  let text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  const runs = text.match(/\n+/g) ?? [];
  if (runs.length && runs.every((run) => run.length >= 2)) {
    text = text.replace(/\n+/g, (run) => '\n'.repeat(Math.ceil(run.length / 2)));
  }
  return text.split('\n').map((line) => line.replace(/\s+$/, ''));
}

/** Fall back to any recent day's poem rather than leaving the section empty. */
async function newestCachedPoem(ymd, days) {
  const now = new Date(`${ymd}T12:00:00Z`);
  for (let i = 1; i <= days; i++) {
    const prior = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const entry = await cache.read(`poem_parsebot_${prior}`);
    if (entry?.data) return entry;
  }
  return null;
}
