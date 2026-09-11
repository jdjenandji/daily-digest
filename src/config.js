import { readFile, access, copyFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG = process.env.DIGEST_CONFIG ?? path.join(ROOT, 'config.json');
const EXAMPLE = path.join(ROOT, 'config.example.json');

export async function loadConfig() {
  try { await access(CONFIG); }
  catch { await copyFile(EXAMPLE, CONFIG); }

  let cfg;
  try { cfg = JSON.parse(await readFile(CONFIG, 'utf8')); }
  catch (err) { throw new Error(`config.json is not valid JSON: ${err.message}`); }

  validate(cfg);
  cfg.paths = { root: ROOT, outDir: path.resolve(ROOT, cfg.output.dir) };
  return cfg;
}

/** Fail fast with a field-level message rather than a TypeError three files later. */
function validate(c) {
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(msg); };

  need(c.location && Number.isFinite(c.location.latitude) && Number.isFinite(c.location.longitude),
    'location.latitude and location.longitude must be numbers');
  need(typeof c.location?.timezone === 'string', 'location.timezone must be an IANA zone, e.g. "Europe/Berlin"');
  need(Array.isArray(c.news) && c.news.length > 0, 'news must be a non-empty array');
  (c.news ?? []).forEach((s, i) => {
    need(s.id && s.name && s.url, `news[${i}] needs id, name and url`);
    need(['rss', 'sitemap'].includes(s.adapter), `news[${i}].adapter must be "rss" or "sitemap"`);
  });
  need(Array.isArray(c.markets?.groups) && c.markets.groups.length > 0, 'markets.groups must be a non-empty array');
  need(Number.isInteger(c.headlinesPerSource) && c.headlinesPerSource > 0, 'headlinesPerSource must be a positive integer');
  need(c.output?.dir, 'output.dir is required');

  if (c.location?.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: c.location.timezone }); }
    catch { bad.push(`location.timezone "${c.location.timezone}" is not a recognised IANA zone`); }
  }
  if (bad.length) throw new Error(`Invalid config.json:\n  - ${bad.join('\n  - ')}`);
}

/** Midnight-to-midnight in the configured zone, as absolute instants. */
export function dayBounds(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const g = (t) => parts.find((p) => p.type === t).value;
  const ymd = `${g('year')}-${g('month')}-${g('day')}`;

  // Find the UTC instant whose local wall time in `timezone` is exactly midnight.
  const guess = new Date(`${ymd}T00:00:00Z`);
  const asLocal = new Date(guess.toLocaleString('en-US', { timeZone: timezone }));
  const asUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  const start = new Date(guess.getTime() + (asUtc.getTime() - asLocal.getTime()));
  const end = new Date(start.getTime() + 24 * 3_600_000);
  return { ymd, start, end };
}
