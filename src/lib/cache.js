import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve(process.cwd(), 'cache');
const safe = (key) => key.replace(/[^a-zA-Z0-9._-]/g, '_');

export async function read(key) {
  try {
    const raw = await readFile(path.join(DIR, `${safe(key)}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.fetchedAt !== 'number') return null;
    return parsed;
  } catch { return null; }
}

export async function write(key, data) {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(path.join(DIR, `${safe(key)}.json`), JSON.stringify({ fetchedAt: Date.now(), data }));
  } catch { /* cache is an optimisation; never fail a run over it */ }
}

/** Cache entry younger than maxAgeMinutes, for fast repeated Generate clicks. */
export async function readFresh(key, maxAgeMinutes) {
  const e = await read(key);
  if (!e) return null;
  return Date.now() - e.fetchedAt <= maxAgeMinutes * 60_000 ? e : null;
}

/** Cache entry old but still usable, for when the upstream is down. */
export async function readStale(key, maxAgeHours) {
  const e = await read(key);
  if (!e) return null;
  return Date.now() - e.fetchedAt <= maxAgeHours * 3_600_000 ? e : null;
}
