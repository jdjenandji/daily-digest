import { execFile } from 'node:child_process';
import { ensureBuilt, BIN } from '../../scripts/build-native.mjs';
import * as cache from '../lib/cache.js';
import { ok, fail } from '../lib/result.js';
import { dayBounds } from '../config.js';
import { dateKey } from '../lib/fmt.js';

const ID = 'calendar';

const MESSAGES = {
  notDetermined: 'Calendar access has not been granted yet. Run: npm run calendar:auth',
  denied: 'Calendar access was refused. Enable it in System Settings › Privacy & Security › Calendars.',
  restricted: 'Calendar access is restricted on this Mac, possibly by a device policy.',
};

/**
 * A permission problem must never cost you the weather and the markets, so every
 * failure here still returns a successful result carrying a visible notice. An empty
 * section would read as "no meetings today", which is worse than an honest warning.
 */
export async function fetchCalendar(cfg, { interactive = false } = {}) {
  const tz = cfg.location.timezone;
  const { ymd, start, end } = dayBounds(tz);
  const key = `calendar_${ymd}`;

  // Same-day cache only. Unlike every other source, calendar NEVER falls back to a
  // previous day: yesterday's meetings are worse than nothing.
  const fresh = await cache.readFresh(key, cfg.cache.freshMinutes);
  if (fresh && dateKey(new Date(), tz) === ymd) {
    return ok(ID, fresh.data, { fromCache: true, fetchedAt: fresh.fetchedAt });
  }

  try {
    await ensureBuilt({ quiet: true });
  } catch (err) {
    return ok(ID, notice(ymd, `Could not build the calendar helper: ${err.message}`));
  }

  const args = ['--start', start.toISOString(), '--end', end.toISOString()];
  if (!interactive) args.push('--no-prompt');
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

function spawnBridge(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(BIN, args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 << 20 },
      (err, stdout) => {
        // Parse stdout regardless: the helper reports permission states in JSON with
        // exit code 0, and a non-zero exit only ever means a real crash.
        const text = (stdout ?? '').trim();
        if (text) {
          try { return resolve(JSON.parse(text)); } catch { /* fall through */ }
        }
        if (err) return reject(new Error(err.killed ? 'timed out' : err.message));
        reject(new Error('helper produced no output'));
      });
  });
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
