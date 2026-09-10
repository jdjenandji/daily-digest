#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, mkdir, chmod, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = process.cwd();
const SRC = path.join(ROOT, 'native', 'CalendarBridge.swift');
const PLIST = path.join(ROOT, 'native', 'Info.plist');

/**
 * The helper is built as a real .app bundle, not a bare executable.
 *
 * This is not cosmetic. macOS will not hand calendar access to a loose command-line
 * binary: it never appears in the Privacy pane and cannot raise the permission dialog,
 * so the request just returns "denied" while the status stays "notDetermined". A
 * properly structured, signed bundle with a usage string in its Info.plist is a
 * first-class TCC subject that can prompt, can be listed, and holds its own grant.
 */
export const APP = path.join(ROOT, 'native', 'CalendarBridge.app');
export const BIN = path.join(APP, 'Contents', 'MacOS', 'calendar-bridge');

const mtime = async (p) => { try { return (await stat(p)).mtimeMs; } catch { return null; } };

export async function ensureBuilt({ force = false, quiet = false } = {}) {
  const binAt = await mtime(BIN);
  const srcAt = await mtime(SRC);
  if (srcAt == null) throw new Error(`missing ${SRC}`);
  const plistAt = (await mtime(PLIST)) ?? 0;

  // Rebuild only on a real source change. macOS keys the privacy grant to the code
  // signature, so a needless recompile silently revokes calendar access. This is also
  // why there is deliberately no postinstall hook.
  if (!force && binAt != null && binAt > srcAt && binAt > plistAt) {
    if (!quiet) console.log('calendar-bridge is up to date');
    return { built: false, path: BIN, app: APP };
  }

  if (!quiet) console.log('building CalendarBridge.app…');
  await rm(APP, { recursive: true, force: true });
  await mkdir(path.join(APP, 'Contents', 'MacOS'), { recursive: true });

  await run('swiftc', [
    '-O', '-o', BIN, SRC,
    '-framework', 'EventKit', '-framework', 'Foundation',
  ]);
  await chmod(BIN, 0o755);
  await copyFile(PLIST, path.join(APP, 'Contents', 'Info.plist'));

  // Sign the BUNDLE, not the inner binary, so the identity is the app's.
  await run('codesign', ['--force', '--sign', '-', '--identifier',
    'com.jd.daily-digest.calendar-bridge', APP]);

  if (!quiet) {
    console.log(`built ${path.relative(ROOT, APP)}`);
    if (binAt != null) {
      console.log('note: the bundle changed identity, so macOS will ask for calendar access again.');
    }
  }
  return { built: true, path: BIN, app: APP };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureBuilt({ force: process.argv.includes('--force') })
    .catch((err) => { console.error(err.message); process.exit(1); });
}
