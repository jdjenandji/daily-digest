#!/usr/bin/env node
/** Print the digest that already exists, without regenerating it. */
import { access } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { printFile } from '../src/print.js';

const cfg = await loadConfig();
const file = path.join(cfg.paths.outDir, 'latest.pdf');

try { await access(file); }
catch {
  console.error(`No digest to print at ${file}. Generate one first: npm run digest`);
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const r = await printFile(file, cfg, { dryRun });

if (r.skipped) { console.log(`Not printed: ${r.skipped}`); process.exit(0); }
if (r.ok && r.dryRun) process.exit(0);
if (r.ok) { console.log(`Sent ${path.basename(file)} to ${r.printer} (job ${r.jobId ?? 'submitted'}).`); process.exit(0); }
console.error(`Print failed: ${r.error}`);
process.exit(1);
