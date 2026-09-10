#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = process.cwd();
const SRC = path.join(ROOT, 'native', 'CalendarBridge.swift');
const PLIST = path.join(ROOT, 'native', 'Info.plist');
export const BIN = path.join(ROOT, 'native', 'bin', 'calendar-bridge');

const mtime = async (p) => { try { return (await stat(p)).mtimeMs; } catch { return null; } };

/**
 * Build only when the source is newer than the binary.
 *
 * This matters more than it looks. macOS keys a privacy grant to the binary's code
 * signature, so every recompile produces a new identity and SILENTLY revokes calendar
 * access. Rebuilding only on real source changes keeps the grant alive across ordinary
 * runs, and is why there is deliberately no postinstall hook.
 */
export async function ensureBuilt({ force = false, quiet = false } = {}) {
  const binAt = await mtime(BIN);
  const srcAt = await mtime(SRC);
  if (srcAt == null) throw new Error(`missing ${SRC}`);
  const plistAt = (await mtime(PLIST)) ?? 0;

  if (!force && binAt != null && binAt > srcAt && binAt > plistAt) {
    if (!quiet) console.log('calendar-bridge is up to date');
    return { built: false, path: BIN };
  }

  await mkdir(path.dirname(BIN), { recursive: true });
  if (!quiet) console.log('building calendar-bridge…');

  // The embedded __info_plist section is what makes the permission dialog show a
  // readable reason instead of a bare executable path.
  await run('swiftc', [
    '-O', '-o', BIN, SRC,
    '-framework', 'EventKit', '-framework', 'Foundation',
    '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', PLIST,
  ]);
  await chmod(BIN, 0o755);
  await run('codesign', ['-s', '-', '-f', BIN]);

  if (!quiet) console.log(`built ${path.relative(ROOT, BIN)}`);
  if (binAt != null && !quiet) {
    console.log('note: the binary changed identity, so macOS may ask for calendar access again.');
  }
  return { built: true, path: BIN };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureBuilt({ force: process.argv.includes('--force') })
    .catch((err) => { console.error(err.message); process.exit(1); });
}
