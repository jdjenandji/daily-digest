#!/usr/bin/env node
/**
 * Ask macOS for calendar access.
 *
 * The helper is an .app bundle launched through LaunchServices, so it is its own
 * responsible process. That means one grant covers every way you run the digest:
 * this terminal, an editor, an agent, and the scheduled daily job.
 */
import { loadConfig } from '../src/config.js';
import { requestAccess, listCalendars } from '../src/sources/calendar.js';

const cfg = await loadConfig();
console.log('Requesting calendar access. Answer the macOS dialog if it appears…\n');

const result = await requestAccess(cfg);

if (result.status === 'ok') {
  console.log('Granted.\n');
  const cals = await listCalendars(cfg).catch(() => []);
  if (cals.length) {
    console.log('Calendars found:');
    for (const c of cals) console.log(`  - ${c.title}  (${c.source})`);
    console.log('\nTo show only some of these, set calendar.include in config.json.');
  }
} else {
  console.log(`Not granted (${result.status}). ${result.message ?? ''}`);
  console.log('Enable "Daily Digest Calendar" in System Settings › Privacy & Security › Calendars.');
  process.exit(1);
}
