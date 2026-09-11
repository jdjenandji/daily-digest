import { execFile } from 'node:child_process';
import { readFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureBuilt, APP } from '../../scripts/build-native.mjs';
import * as cache from '../lib/cache.js';
import { ok, fail } from '../lib/result.js';
import { dayBounds } from '../config.js';
import { dateKey } from '../lib/fmt.js';

const ID = 'calendar';

const MESSAGES = {
  notDetermined: 'Calendar access has not been granted yet. Run: npm run calendar:auth',
  timeout: 'The calendar helper did not respond in time.',
  denied: 'Calendar access was refused. Enable it in System Settings › Privacy & Security › Calendars.',
  restricted: 'Calendar access is restricted on this Mac, possibly by a device policy.',
};

/**
 * A permission problem must never cost you the weather and the markets, so every
 * failure here still returns a successful result carrying a visible notice. An empty
 * section would read as "no meetings today", which is worse than an honest warning.
 */
export async function fetchCalendar(cfg) {
  const tz = cfg.location.timezone;
  const { ymd, start, end } = dayBounds(tz);
  const key = `calendar_${ymd}`;

  // Same-day cache only. Unlike every other source, calendar NEVER falls back to a
  // previous day: yesterday's meetings are worse than nothing.
  const fresh = await cache.readFresh(key, cfg.cache.freshMinutes);
  if (fresh && dateKey(new Date(), tz) === ymd) {
    return ok(ID, fresh.data, { fetchedAt: fresh.fetchedAt });
  }

  try {
    await ensureBuilt({ quiet: true });
  } catch (err) {
    return ok(ID, notice(ymd, `Could not build the calendar helper: ${err.message}`));
  }

  const args = ['--no-prompt', '--start', start.toISOString(), '--end', end.toISOString()];
  const include = cfg.calendar?.include;
  if (Array.isArray(include) && include.length) args.push('--calendars', include.join(','));

  let payload;
  try {
    payload = await spawnBridge(args, cfg.timeouts.calendarMs);
  } catch (err) {
    return ok(ID, notice(ymd, `Calendar helper did not respond: ${err.message}`));
  }

  if (payload.status !== 'ok') {
    return ok(ID, notice(ymd, MESSAGES[payload.status] ?? payload.message ?? 'Calendar unavailable.'));
  }

  const data = shape(payload, cfg, ymd);
  await cache.write(key, data);
  return ok(ID, data);
}

/** Always --no-prompt: browsing the UI must never raise a system permission dialog. */
export async function listCalendars(cfg) {
  await ensureBuilt({ quiet: true });
  const payload = await spawnBridge(['--list-calendars', '--no-prompt'], cfg.timeouts.calendarMs);
  if (payload.status !== 'ok') throw new Error(MESSAGES[payload.status] ?? 'calendar access unavailable');
  return payload.calendars ?? [];
}

/**
 * Launch the helper through LaunchServices rather than executing the binary directly.
 *
 * This is the whole reason calendar access works. A binary spawned from a shell is
 * attributed to whichever app owns that shell, so the grant would have to be repeated
 * for every terminal, editor or agent you ever run it from, and hosts without a
 * calendar usage string in their Info.plist cannot raise the dialog at all. Launched as
 * an app, the bundle is its own responsible process: one grant, and it holds from
 * anywhere, including the scheduled run.
 *
 * LaunchServices gives the caller no pipe, so the helper writes JSON to --out and this
 * polls for the file.
 */
async function spawnBridge(args, timeoutMs) {
  const dir = path.resolve(process.cwd(), 'cache');
  await mkdir(dir, { recursive: true });
  const outFile = path.join(dir, `.calendar-${randomUUID()}.json`);

  await new Promise((resolve, reject) => {
    execFile('open', ['-a', APP, '--args', ...args, '--out', outFile],
      { timeout: 10_000 }, (err) => (err ? reject(new Error(`could not launch helper: ${err.message}`)) : resolve()));
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = (await readFile(outFile, 'utf8')).trim();
      if (text) {
        const parsed = JSON.parse(text);
        await unlink(outFile).catch(() => {});
        return parsed;
      }
    } catch { /* not written yet, or a partial write */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  await unlink(outFile).catch(() => {});
  throw new Error('timed out waiting for the calendar helper');
}

/** Ask for access under the bundle's own identity. Used by `npm run calendar:auth`. */
export async function requestAccess(cfg) {
  await ensureBuilt({ quiet: true });
  return spawnBridge(['--request-access'], 120_000);
}

const notice = (ymd, message) => ({ ymd, events: [], allDay: [], warnings: [], notice: message });

function shape(payload, cfg, ymd) {
  const events = (payload.events ?? [])
    .filter((e) => e.status !== 'canceled')
    .filter((e) => cfg.calendar?.includeAllDay !== false || !e.allDay);

  const excluded = new Set((cfg.calendar?.exclude ?? []).map((s) => s.toLowerCase()));
  const kept = events.filter((e) => !excluded.has((e.calendar ?? '').toLowerCase()));

  return {
    ymd,
    allDay: kept.filter((e) => e.allDay),
    events: kept.filter((e) => !e.allDay),
    warnings: payload.warnings ?? [],
    notice: null,
  };
}
