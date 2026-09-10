#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/config.js';

const run = promisify(execFile);
export const LABEL = 'com.jd.daily-digest';
export const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function plistBody({ node, script, cwd, hour, minute, outLog, errLog }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(script)}</string>
    <string>--no-prompt</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(cwd)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${xml(outLog)}</string>
  <key>StandardErrorPath</key><string>${xml(errLog)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}

async function main() {
  const cfg = await loadConfig();
  const cwd = process.cwd();
  await mkdir(path.join(cwd, 'logs'), { recursive: true });
  await mkdir(path.dirname(PLIST), { recursive: true });

  // launchd runs with a minimal PATH and cannot find a bare `node`, so the absolute
  // interpreter is baked in. A Node upgrade will invalidate it; `npm run doctor` checks.
  const body = plistBody({
    node: process.execPath,
    script: path.join(cwd, 'src', 'cli.js'),
    cwd,
    hour: cfg.schedule?.hour ?? 6,
    minute: cfg.schedule?.minute ?? 30,
    outLog: path.join(cwd, 'logs', 'agent.out.log'),
    errLog: path.join(cwd, 'logs', 'agent.err.log'),
  });
  await writeFile(PLIST, body);

  const uid = process.getuid();
  // `bootout` then `bootstrap`: `load`/`unload` are deprecated and fail confusingly.
  await run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch(() => {});
  await run('launchctl', ['bootstrap', `gui/${uid}`, PLIST]);

  const h = String(cfg.schedule?.hour ?? 6).padStart(2, '0');
  const m = String(cfg.schedule?.minute ?? 30).padStart(2, '0');
  console.log(`Scheduled ${LABEL} for ${h}:${m} daily.`);
  console.log(`  plist:  ${PLIST}`);
  console.log(`  node:   ${process.execPath}`);
  console.log(`  logs:   logs/agent.out.log`);
  console.log('');
  console.log('Run it now without waiting for morning:');
  console.log(`  launchctl kickstart -k gui/${uid}/${LABEL}`);
  console.log('');
  console.log('The scheduled job runs with --no-prompt, so it can never raise a permission');
  console.log('dialog. If the calendar section says access is not granted, run that kickstart');
  console.log('once while logged in and answer the prompt.');
}

// Only install when run directly. uninstall-agent.mjs imports LABEL and PLIST from
// here, and without this guard importing it would reinstall the agent it is removing.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
