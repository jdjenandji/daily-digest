#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { loadConfig } from './config.js';
import { collect } from './digest.js';
import { renderHtml } from './render/template.js';
import { renderPdf } from './render/pdf.js';
import { printFile } from './print.js';
import { acquire } from './lib/lock.js';
import { log, warn, error } from './lib/log.js';

const dryRun = process.argv.includes('--dry-run');
const noPrint = process.argv.includes('--no-print');

async function main() {
  const cfg = await loadConfig();

  const release = await acquire();
  if (!release) {
    log('another digest run is already in progress; exiting');
    return;
  }

  try {
    log('collecting sources…');
    const model = await collect(cfg);

    for (const s of model.statuses) {
      if (s.state !== 'ok') log(`  ${s.label}: ${s.state}`);
    }

    const html = await renderHtml(model);
    const { pdf, heightMm, pages } = await renderPdf(html, cfg);

    await mkdir(cfg.paths.outDir, { recursive: true });
    const name = cfg.output.filename.replace('{date}', model.ymd);
    const file = path.join(cfg.paths.outDir, name);
    await writeFile(file, pdf);
    if (cfg.output.writeLatest) {
      await writeFile(path.join(cfg.paths.outDir, 'latest.pdf'), pdf);
    }

    log(`wrote ${file} (${(pdf.length / 1024).toFixed(0)} KB, ${heightMm}mm of copy, ~${pages} pages)`);
    log(`sources: ${model.statuses.filter((s) => s.state === 'ok').length}/${model.statuses.length} ok`
      + `${model.degraded.length ? `, degraded: ${model.degraded.map((d) => d.label).join(', ')}` : ''}`);

    // Printing is the last step and never fails the run: the PDF is already on disk.
    if (!noPrint) {
      const r = await printFile(file, cfg, { dryRun });
      if (r.skipped) log(`not printed: ${r.skipped}`);
      else if (r.ok && !r.dryRun) log(`sent to ${r.printer} (job ${r.jobId ?? 'submitted'})`);
      else if (!r.ok) warn(`print failed: ${r.error}`);
    }

    if (cfg.output.openAfterGenerate && process.stdout.isTTY) {
      execFile('open', [file], () => {});
    }
  } finally {
    await release();
  }
}

main().catch((err) => { error(err.stack ?? err.message); process.exit(1); });
