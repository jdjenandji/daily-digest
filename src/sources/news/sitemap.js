import { XMLParser } from 'fast-xml-parser';
import { getText } from '../../lib/http.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  removeNSPrefix: true, // news:title -> title, news:publication_date -> publication_date
});

/**
 * Reuters retired every public RSS feed, so their Google News sitemap is the source.
 * It is the freshest feed of the six, but two things must be handled here:
 *  - it declares every entry as English, including German and French copy, so the
 *    language filter has to read the URL locale segment instead;
 *  - it is only loosely ordered, so the caller sorts by publication date.
 */
export async function fetchSitemap(source, cfg) {
  const xml = await getText(source.url, { timeoutMs: cfg.timeouts.newsMs });
  const doc = parser.parse(xml);

  let urls = doc?.urlset?.url ?? [];
  if (!Array.isArray(urls)) urls = [urls];

  const blocked = new Set(source.excludeLocales ?? []);

  return urls.map((u) => {
    const news = u.news?.news ?? u.news ?? {};
    const loc = str(u.loc);
    return {
      headline: str(news.title),
      standfirst: '',
      url: loc,
      published: toDate(str(news.publication_date) || str(u.lastmod)),
      locale: localeOf(loc),
    };
  }).filter((i) => i.headline && !blocked.has(i.locale));
}

/** https://www.reuters.com/de/firma/... -> "de";  /world/china/... -> null */
function localeOf(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
    return seg && /^[a-z]{2}$/.test(seg) ? seg : null;
  } catch { return null; }
}

function str(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') return str(v['#text'] ?? '');
  return String(v);
}

function toDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
