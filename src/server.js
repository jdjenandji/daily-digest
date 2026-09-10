#!/usr/bin/env node
import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { collect } from './digest.js';
import { renderHtml } from './render/template.js';
import { renderPdf, sharedBrowser, closeShared } from './render/pdf.js';
import { listCalendars } from './sources/calendar.js';
import { acquire } from './lib/lock.js';
import { log, error } from './lib/log.js';

const cfg = await loadConfig();
let lastPdf = null;
let idleTimer = null;

// Keep one browser warm between clicks, but do not hold Chrome resident all day.
function touchIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => closeShared().catch(() => {}), 5 * 60_000);
  idleTimer.unref?.();
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/' ) {
      const html = await readFile(path.resolve('public/index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // Fast layout iteration: the same model, rendered as plain HTML in a live tab.
    if (url.pathname === '/api/preview') {
      const html = await renderHtml(await collect(cfg));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const release = await acquire();
      if (!release) return json(res, 409, { ok: false, error: 'a digest run is already in progress' });
      try {
        const started = Date.now();
        const model = await collect(cfg);
        const html = await renderHtml(model);
        const browser = await sharedBrowser(cfg);
        touchIdle();
        const { pdf, pages } = await renderPdf(html, cfg, { browser });

        await mkdir(cfg.paths.outDir, { recursive: true });
        const name = cfg.output.filename.replace('{date}', model.ymd);
        await writeFile(path.join(cfg.paths.outDir, name), pdf);
        if (cfg.output.writeLatest) await writeFile(path.join(cfg.paths.outDir, 'latest.pdf'), pdf);
        lastPdf = pdf;

        return json(res, 200, {
          ok: true,
          file: name,
          bytes: pdf.length,
          pages,
          ms: Date.now() - started,
          statuses: model.statuses,
          generatedAt: model.generatedAt,
        });
      } finally { await release(); }
    }

    if (url.pathname === '/api/pdf') {
      const buf = lastPdf ?? await readFile(path.join(cfg.paths.outDir, 'latest.pdf')).catch(() => null);
      if (!buf) return json(res, 404, { ok: false, error: 'no digest generated yet' });
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="daily-digest.pdf"' });
      return res.end(buf);
    }

    if (url.pathname === '/api/calendars') {
      try { return json(res, 200, { ok: true, calendars: await listCalendars(cfg) }); }
      catch (err) { return json(res, 200, { ok: false, error: err.message }); }
    }

    if (url.pathname === '/api/status') {
      const out = await stat(path.join(cfg.paths.outDir, 'latest.pdf')).catch(() => null);
      const agent = await stat(path.resolve('logs/agent.out.log')).catch(() => null);
      return json(res, 200, {
        ok: true,
        location: cfg.location.label,
        sources: cfg.news.map((n) => n.name),
        lastGenerated: out?.mtimeMs ?? null,
        lastScheduledRun: agent?.mtimeMs ?? null,
      });
    }

    json(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    error(err.stack ?? err.message);
    json(res, 500, { ok: false, error: err.message });
  }
});

server.listen(cfg.server.port, cfg.server.host, () => {
  log(`Daily Digest ready at http://${cfg.server.host}:${cfg.server.port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await closeShared().catch(() => {}); server.close(); process.exit(0); });
}
