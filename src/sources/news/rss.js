import { XMLParser } from 'fast-xml-parser';
import { getText } from '../../lib/http.js';
import { stripTags } from '../../lib/fmt.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Bild wraps every field in CDATA; keep values as strings so dates survive intact.
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
});

/** The five newspaper feeds. Plain RSS 2.0, but each with its own quirks. */
export async function fetchRss(source, cfg) {
  const xml = await getText(source.url, { timeoutMs: cfg.timeouts.newsMs });
  const doc = parser.parse(xml);

  let items = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  if (!Array.isArray(items)) items = [items];

  return items.map((it) => {
    const title = text(it.title);
    const standfirst = stripTags(text(it.description) || text(it.summary));
    const published = toDate(text(it.pubDate) || text(it.published) || text(it['dc:date']));
    return {
      headline: title,
      standfirst: standfirst && standfirst !== title ? standfirst : '',
      url: text(it.link?.['@_href'] ?? it.link),
      published,
    };
  }).filter((i) => i.headline);
}

function text(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return text(v['#text'] ?? '');
  return '';
}

/** Bild emits "CEST"/"CET", which Date cannot parse. Map to a numeric offset. */
const ZONES = { CEST: '+0200', CET: '+0100', MESZ: '+0200', MEZ: '+0100' };

function toDate(s) {
  if (!s) return null;
  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  const fixed = s.replace(/\b(CEST|CET|MESZ|MEZ)\b/, (m) => ZONES[m]);
  d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
