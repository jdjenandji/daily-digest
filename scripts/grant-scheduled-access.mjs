#!/usr/bin/env node
/**
 * Grants calendar access to the SCHEDULED identity.
 *
 * macOS attributes a privacy grant to the responsible process. Running the helper
 * from a terminal grants that terminal; running it from Claude grants Claude. None of
 * those help the launchd job, where the helper binary is its own responsible process.
 *
 * The daily job always runs with --no-prompt so it can never raise a dialog on an
 * unattended machine, which also means it can never ask for access itself. This script
 * closes that loop: it loads a one-shot LaunchAgent that runs the helper with
 * --request-access, so the prompt appears under launchd's identity, then removes it.
 */
import { writeFile, unlink, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { ensureBuilt, BIN } from './build-native.mjs';

const run = promisify(execFile);
const LABEL = 'com.jd.daily-digest.auth';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG = path.resolve('logs', 'auth.out.log');
const uid = process.getuid();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await ensureBuilt({ quiet: true });
  await mkdir(path.dirname(LOG), { recursive: true });
  await writeFile(LOG, '');

  await writeFile(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BIN}</string>
    <string>--request-access</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
`);

  await run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch(() => {});
  await run('launchctl', ['bootstrap', `gui/${uid}`, PLIST]);

  console.log('A macOS dialog should now be asking for calendar access.');
  console.log('Click Allow. Waiting up to 90 seconds…\n');

  let result = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const text = (await readFile(LOG, 'utf8').catch(() => '')).trim();
    if (text) { try { result = JSON.parse(text); break; } catch { /* partial write */ } }
  }

  await run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch(() => {});
  await unlink(PLIST).catch(() => {});

  if (!result) {
    console.log('No answer recorded. If no dialog appeared, open');
    console.log('System Settings › Privacy & Security › Calendars and enable "calendar-bridge".');
    process.exit(1);
  }
  if (result.status === 'ok') {
    console.log('Granted. The scheduled digest can now read your calendar.');
    console.log('Verify with: npm run doctor');
  } else {
    console.log(`Not granted (${result.status}). ${result.message ?? ''}`);
    console.log('You can enable it in System Settings › Privacy & Security › Calendars.');
    process.exit(1);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
