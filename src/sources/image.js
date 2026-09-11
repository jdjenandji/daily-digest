import { get, getJson } from '../lib/http.js';
import * as cache from '../lib/cache.js';
import { ok, fail } from '../lib/result.js';
import { dayBounds } from '../config.js';

const ID = 'image';
const API = 'https://api.are.na/v2/channels';
const PER_PAGE = 100;

/**
 * One image a day from a public Are.na channel.
 *
 * Fetched through Are.na's documented public API, and embedded as a data URI rather
 * than linked. The page is rendered to PDF with no network access by design: an asset
 * that loads at render time is the classic cause of a half-drawn or blank page, so the
 * bytes are inlined before Chrome ever sees the HTML.
 *
 * Like the poem, the choice is keyed to the date, so it is stable all day.
 */
export async function fetchImage(cfg, configKey = 'image', { refresh = false, seed = null } = {}) {
  const c = cfg[configKey] ?? {};
  const id = configKey === 'image' ? ID : configKey;
  if (!c.enabled) return ok(id, null);
  if (!c.channel) return fail(id, new Error(`${configKey}.channel is not set in config.json`));

  const { ymd } = dayBounds(cfg.location.timezone);
  const key = `image_${c.channel}_${ymd}`;

  const cached = await cache.read(key);
  if (cached?.data && !refresh) return ok(id, cached.data, { fetchedAt: cached.fetchedAt });

  try {
    // One small request for the channel's size, then one page of it. Pulling all 2000+
    // blocks to pick one would be wasteful and slow.
    const head = await getJson(`${API}/${c.channel}?per=1`, { timeoutMs: c.timeoutMs ?? 8000 });
    const total = head?.length ?? 0;
    if (!total) throw new Error('channel is empty or unavailable');

    // A normal run is stable for the day. An explicit refresh uses a new seed and
    // avoids the current block when it happens to land on the same channel page.
    const choiceSeed = refresh ? `${ymd}:${seed ?? Date.now()}` : ymd;
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const page = (hash(choiceSeed) % pages) + 1;
    const body = await getJson(`${API}/${c.channel}/contents?per=${PER_PAGE}&page=${page}`,
      { timeoutMs: c.timeoutMs ?? 8000 });

    const images = (body?.contents ?? []).filter((b) => b?.class === 'Image' && b?.image);
    if (!images.length) throw new Error(`no images on page ${page} of the channel`);

    const alternatives = refresh && cached?.data?.link
      ? images.filter((block) => `https://www.are.na/block/${block.id}` !== cached.data.link)
      : images;
    const pool = alternatives.length ? alternatives : images;
    const block = pool[hash(`${choiceSeed}:${page}`) % pool.length];
    const variant = block.image[c.variant ?? 'display'] ?? block.image.display ?? block.image.large;
    if (!variant?.url) throw new Error('image block carried no usable URL');

    const res = await get(variant.url, { timeoutMs: c.downloadTimeoutMs ?? 15000 });
    const bytes = Buffer.from(await res.arrayBuffer());
    const max = (c.maxKb ?? 400) * 1024;
    if (bytes.length > max) throw new Error(`image is ${Math.round(bytes.length / 1024)}KB, over the ${c.maxKb ?? 400}KB cap`);

    const data = {
      dataUri: `data:${block.image.content_type ?? 'image/jpeg'};base64,${bytes.toString('base64')}`,
      bytes: bytes.length,
      title: (block.generated_title || block.title || '').trim(),
      channel: head.title ?? c.channel,
      owner: (head.user ?? {}).full_name ?? '',
      link: `https://www.are.na/block/${block.id}`,
    };

    await cache.write(key, data);
    return ok(id, data);
  } catch (err) {
    // An older image is still a fine image, so fall back rather than leaving a gap.
    const stale = cached ?? await recentCached(c.channel, c.maxStaleDays ?? 7);
    if (stale) return ok(id, stale.data, { fromCache: true, fetchedAt: stale.fetchedAt });
    return fail(id, err);
  }
}

async function recentCached(channel, days) {
  const now = new Date();
  for (let i = 1; i <= days; i++) {
    const ymd = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const entry = await cache.read(`image_${channel}_${ymd}`);
    if (entry?.data) return entry;
  }
  return null;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
