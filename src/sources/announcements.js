import { getText } from '../lib/http.js';
import * as cache from '../lib/cache.js';
import { ok, fail } from '../lib/result.js';
import { dayBounds } from '../config.js';
import { clip } from '../lib/fmt.js';

const ID = 'announcements';

/**
 * Exhibition announcements, titles only.
 *
 * e-flux publishes no feed: both documented RSS paths 404, so this reads the listing
 * page. Their robots.txt allows /announcements for general agents while blocking named
 * training crawlers, which is not what this is, and the page answers plainly with no
 * challenge.
 *
 * Parsing markup is brittle by nature, so a layout change here degrades to a labelled
 * gap rather than a broken page, and doctor reports the count so a silent drop to zero
 * is visible rather than looking like a quiet day.
 */
export async function fetchAnnouncements(cfg) {
  const a = cfg.announcements ?? {};
  if (!a.enabled) return ok(ID, null);

  const { ymd } = dayBounds(cfg.location.timezone);
  const key = `announcements_${ymd}`;

  const fresh = await cache.readFresh(key, cfg.cache?.freshMinutes ?? 15);
  if (fresh?.data) return ok(ID, fresh.data, { fetchedAt: fresh.fetchedAt });

  try {
    const html = await getText(a.url, { timeoutMs: a.timeoutMs ?? 12000 });
    const items = parse(html, a.limit ?? 14);
    if (!items.length) throw new Error('no announcements found; the page layout may have changed');

    const data = { items, source: a.source ?? 'e-flux' };
    await cache.write(key, data);
    return ok(ID, data);
  } catch (err) {
    const stale = await cache.readStale(key, a.maxStaleHours ?? 48);
    if (stale?.data) return ok(ID, stale.data, { fromCache: true, fetchedAt: stale.fetchedAt });
    return fail(ID, err);
  }
}

/**
 * Each announcement is a content block holding the institution and then the title.
 * They are read as a pair rather than separately, so a venue can never be attached to
 * the wrong exhibition. The pairing also rescues titles that say nothing alone, like
 * "Issue 165" or "Fall programme".
 *
 * The outer cell-title container is used rather than the inner announcement-title
 * class: the inner one covered eight of the fifteen on the sampled page.
 */
function parse(html, limit) {
  const blocks = [...html.matchAll(
    /<div class="featured-projects__cell-content">(.*?)<div class="featured-projects__cell-title">(.*?)<\/div>\s*<\/div>/gs)];

  const seen = new Set();
  const out = [];
  for (const [, head, titleFrag] of blocks) {
    const title = clean(titleFrag);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const venueMatch = head.match(/<div class="featured-projects__cell-client">(.*?)<\/div>/s);
    out.push({
      venue: venueMatch ? clip(clean(venueMatch[1]), 40) : '',
      title: clip(title, 76),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function clean(frag) {
  return decode(frag
    .replace(/<br\s*\/?>/gi, ' — ')     // artist and work sit on separate lines
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[—·\s]+|[—·\s]+$/g, '');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
