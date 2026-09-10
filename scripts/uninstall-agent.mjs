#!/usr/bin/env node
import { unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LABEL, PLIST } from './install-agent.mjs';

const run = promisify(execFile);
const uid = process.getuid();

await run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch(() => {});
await unlink(PLIST).catch(() => {});
console.log(`Removed the ${LABEL} schedule. Generated PDFs in out/ are untouched.`);
