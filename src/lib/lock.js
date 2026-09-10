import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';

const FILE = path.resolve(process.cwd(), 'cache', '.generate.lock');
const STALE_MS = 120_000;

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// The PID file cannot detect a second run inside THIS process, since the pid matches.
let held = false;

/** Stops a manual Generate click colliding with the 06:30 run and launching two Chromes. */
export async function acquire() {
  if (held) return null;
  await mkdir(path.dirname(FILE), { recursive: true });
  try {
    const raw = JSON.parse(await readFile(FILE, 'utf8'));
    const fresh = Date.now() - raw.at < STALE_MS;
    if (fresh && raw.pid !== process.pid && alive(raw.pid)) return null;
  } catch { /* no lock, or unreadable: take it */ }
  held = true;
  await writeFile(FILE, JSON.stringify({ pid: process.pid, at: Date.now() }));
  return async () => {
    held = false;
    try { await unlink(FILE); } catch {}
  };
}
