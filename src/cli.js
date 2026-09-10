#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { loadConfig } from './config.js';
import { collect } from './digest.js';
import { renderHtml } from './render/template.js';
import { renderPdf } from './render/pdf.js';
import { acquire } from './lib/lock.js';
import { log, error } from './lib/log.js';

const interactive = process.stdout.isTTY && !process.argv.includes('--no-prompt');

async function main() {
  const cfg = await loadConfig();

  const release = await acquire();
  if (!release) {
    log('another digest run is already in progress; exiting');
    return;
  }

  try {
    log('collecting sources…');
    const model = await collect(cfg, { interactive });

    for (const s of model.statuses) {
      if (s.state !== 'ok') log(`  ${s.label}: ${s.state}`);
    }

    const html = await renderHtml(model);
    const { pdf, scale, tallestMm } = await renderPdf(html, cfg);

    await mkdir(cfg.paths.outDir, { recursive: true });
    const name = cfg.output.filename.replace('{date}', model.ymd);
    const file = path.join(cfg.paths.outDir, name);
    await writeFile(file, pdf);
    if (cfg.output.writeLatest) {
      await writeFile(path.join(cfg.paths.outDir, 'latest.pdf'), pdf);
    }

    log(`wrote ${file} (${(pdf.length / 1024).toFixed(0)} KB, ${tallestMm}mm tallest page`
      + `${scale < 1 ? `, scaled to ${scale}` : ''})`);
    log(`sources: ${model.statuses.filter((s) => s.state === 'ok').length}/${model.statuses.length} ok`
      + `${model.degraded.length ? `, degraded: ${model.degraded.map((d) => d.label).join(', ')}` : ''}`);

    if (cfg.output.openAfterGenerate && interactive) {
      execFile('open', [file], () => {});
    }
  } finally {
    await release();
  }
}

main().catch((err) => { error(err.stack ?? err.message); process.exit(1); });
