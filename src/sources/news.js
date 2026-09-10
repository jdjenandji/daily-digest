import { fetchRss } from './news/rss.js';
import { fetchSitemap } from './news/sitemap.js';
import * as cache from '../lib/cache.js';
import { ok, fail } from '../lib/result.js';
import { clip } from '../lib/fmt.js';

const ADAPTERS = { rss: fetchRss, sitemap: fetchSitemap };
const STALE_AFTER_MS = 24 * 3_600_000;

const HEADLINE_MAX = 95;

/** Fetch all six sources in parallel. One dead paper never costs the others. */
export async function fetchNews(cfg) {
  const results = await Promise.all(cfg.news.map((s) => fetchOne(s, cfg)));
  return results;
}

async function fetchOne(source, cfg) {
  const id = `news_${source.id}`;
  const limit = source.limit ?? cfg.headlinesPerSource;

  try {
    const adapter = ADAPTERS[source.adapter];
    if (!adapter) throw new Error(`unknown adapter "${source.adapter}"`);

    const raw = await adapter(source, cfg);
    const data = shape(source, raw, limit);
    if (data.items.length === 0) throw new Error('feed returned no usable items');

    await cache.write(id, data);
    return ok(id, data);
  } catch (err) {
    const stale = await cache.readStale(id, cfg.cache.newsMaxStaleHours);
    if (stale) {
      return ok(id, { ...stale.data, stale: true }, { fromCache: true, fetchedAt: stale.fetchedAt });
    }
    return fail(id, err, { note: source.name });
  }
}

function shape(source, raw, limit) {
  // Feeds are NOT reliably date-ordered. WSJ's newest item sits minutes old inside a
  // list whose median age is two days, so taking the first N would print stale news.
  const sorted = [...raw].sort((a, b) => (b.published ?? 0) - (a.published ?? 0));
  const items = sorted.slice(0, limit).map((i) => present(source, i));

  const newest = sorted[0]?.published ?? null;
  return {
    id: source.id,
    name: source.name,
    items,
    newest,
    // A feed can return HTTP 200 with valid XML and still be frozen: the old WSJ
    // endpoint served January 2025 items indefinitely. Age is the only real check.
    stale: newest != null && Date.now() - newest > STALE_AFTER_MS,
  };
}

function present(source, item) {
  let headline = item.headline;

  // Bild titles are "Kicker - Headline" in every sampled item. Keep only the headline
  // half; the kicker is a subline and is dropped.
  if (source.kicker) {
    const m = headline.match(/^(.{3,45}?)\s+-\s+(.+)$/);
    if (m) headline = m[2].trim();
  }

  return {
    // Headlines only. Le Monde still gets a longer cap because its headlines fuse
    // headline and subhead into one sentence.
    headline: clip(headline, source.headlineMaxChars ?? HEADLINE_MAX),
    url: item.url,
    published: item.published,
  };
}
