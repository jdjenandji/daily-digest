#!/usr/bin/env node
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from './config.js';
import { listCalendars } from './sources/calendar.js';
import { log, error } from './lib/log.js';

const run = promisify(execFile);
const cfg = await loadConfig();
const CLI = path.resolve('src/cli.js');

/**
 * Generation runs as a child process, not in this one.
 *
 * Node caches ES module imports for the life of a process, so a server left running
 * while the code is edited kept rendering the old pipeline and silently overwrote out/
 * with a stale PDF. Reloading one module was not enough: the template was refreshed
 * while digest.js and every source stayed cached, so a newly added section collected no
 * data and rendered as nothing. Shelling out to the CLI gives one always-current code
 * path and removes the whole class of bug, at the cost of process startup.
 */
async function runCli(args = []) {
  return run(process.execPath, [CLI, ...args], { cwd: process.cwd(), maxBuffer: 32 << 20 });
}


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
      const { stdout } = await runCli(['--html']);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(stdout);
    }

    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const started = Date.now();
      const { stdout, stderr } = await runCli(url.searchParams.has('noPrint') ? ['--no-print'] : []);
      const log = `${stdout}${stderr}`;
      if (/another digest run is already in progress/.test(log)) {
        return json(res, 409, { ok: false, error: 'a digest run is already in progress' });
      }
      const file = path.join(cfg.paths.outDir, 'latest.pdf');
      const buf = await readFile(file).catch(() => null);
      if (!buf) return json(res, 500, { ok: false, error: 'the run produced no PDF', log });
      return json(res, 200, {
        ok: true,
        file: path.basename(file),
        bytes: buf.length,
        ms: Date.now() - started,
        pages: Number(/~(\d+) pages/.exec(log)?.[1]) || null,
        log: log.trim(),
        generatedAt: Date.now(),
      });
    }

    if (url.pathname === '/api/pdf') {
      const buf = await readFile(path.join(cfg.paths.outDir, 'latest.pdf')).catch(() => null);
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
  process.on(sig, () => { server.close(); process.exit(0); });
}
