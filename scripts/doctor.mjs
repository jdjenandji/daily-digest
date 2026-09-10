#!/usr/bin/env node
import { access, stat, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { fetchWeather } from '../src/sources/weather.js';
import { fetchMarkets } from '../src/sources/markets.js';
import { fetchNews } from '../src/sources/news.js';
import { findChrome } from '../src/render/pdf.js';
import { fetchCalendar } from '../src/sources/calendar.js';
import { queues, pendingJobs } from '../src/print.js';
import { fetchPoem } from '../src/sources/poem.js';
import { LABEL, PLIST } from './install-agent.mjs';
import { relAge } from '../src/lib/fmt.js';

const run = promisify(execFile);
const rows = [];

const add = (state, name, detail) => rows.push({ state, name, detail });

/**
 * The whole point of this script: a source can fail silently. The old WSJ feed
 * returned HTTP 200 with valid XML frozen 20 months in the past. Checking liveness
 * means checking content age, not status codes.
 */
async function main() {
  const cfg = await loadConfig();

  // --- news -----------------------------------------------------------------
  const news = await fetchNews(cfg);
  news.forEach((r, i) => {
    const name = cfg.news[i].name;
    if (!r.ok) return add('fail', name, r.error);
    const d = r.data;
    const age = d.newest ? relAge(Date.now() - d.newest) : 'no dates';
    if (d.stale) return add('warn', name, `FROZEN: newest item is ${age} — the feed URL is probably dead`);
    add('ok', name, `${d.items.length} headlines, newest ${age}`);
  });

  // --- weather --------------------------------------------------------------
  const w = await fetchWeather(cfg);
  if (!w.ok) add('fail', 'Weather', w.error);
  else add(w.fromCache ? 'warn' : 'ok', `Weather (${cfg.location.label})`,
    `${Math.round(w.data.now.temp)}°C, ${w.data.now.label}${w.fromCache ? ' — served from cache' : ''}`);

  // --- markets --------------------------------------------------------------
  const m = await fetchMarkets(cfg);
  if (!m.ok) add('fail', 'Markets', m.error);
  else {
    const missing = m.data.groups.flatMap((g) => g.rows).filter((r) => r.price == null).map((r) => r.name);
    add(m.data.degraded ? 'warn' : 'ok', `Markets (${m.data.provider})`,
      `${m.data.live}/${m.data.total} instruments${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`);
  }

  // --- chrome ---------------------------------------------------------------
  try {
    const chrome = await findChrome(cfg);
    const pinned = chrome.includes('.cache/puppeteer');
    add(pinned ? 'ok' : 'warn', 'Chrome',
      pinned ? chrome.split('/chrome/')[1]?.split('/')[0] ?? chrome
             : `using system Chrome (${chrome}) — print metrics may shift on its updates`);
  } catch (err) { add('fail', 'Chrome', err.message); }

  // --- calendar -------------------------------------------------------------
  try {
    const r = await fetchCalendar(cfg);
    const d = r.data;
    if (d.notice) add('warn', 'Calendar', d.notice);
    else add('ok', 'Calendar', `${d.events.length} timed + ${d.allDay.length} all-day events today`);
  } catch (err) { add('fail', 'Calendar helper', err.message); }

  // --- poem -----------------------------------------------------------------
  if (cfg.poem?.enabled === false) add('warn', 'Poem', 'disabled in config.json');
  else {
    const r = await fetchPoem(cfg);
    if (!r.ok) add('fail', 'Poem', r.error);
    else if (!r.data) add('warn', 'Poem', 'no poem selected');
    else add(r.fromCache ? 'warn' : 'ok', 'Poem',
      `${r.data.lines.length} lines, ${r.data.author}${r.fromCache ? ' (from an earlier day)' : ''}`);
  }

  // --- printer --------------------------------------------------------------
  // Print is the one step whose failure is otherwise completely invisible: no paper
  // appears and nothing says why. Report it explicitly.
  const pr = cfg.print ?? {};
  if (!pr.enabled) {
    add('warn', 'Printer', 'printing disabled in config.json');
  } else if (!pr.printer) {
    const names = (await queues()).map((q) => q.name);
    add('fail', 'Printer', `print.printer is not set. Available: ${names.join(', ') || 'none'}`);
  } else {
    const all = await queues();
    const q = all.find((x) => x.name === pr.printer);
    if (!q) add('fail', 'Printer', `"${pr.printer}" not found. Available: ${all.map((x) => x.name).join(', ') || 'none'}`);
    else if (!q.enabled) add('fail', 'Printer', `"${pr.printer}" is disabled; enable with: cupsenable ${pr.printer}`);
    else {
      const waiting = (await pendingJobs(pr.printer)).length;
      add('ok', 'Printer', `${pr.printer}, ${q.state}, ${pr.media}/${pr.sides}`
        + (waiting ? `, ${waiting} job(s) queued` : ''));
    }
  }

  // --- schedule -------------------------------------------------------------
  try {
    await access(PLIST);
    const body = await readFile(PLIST, 'utf8');
    const node = body.match(/<string>([^<]*\/node)<\/string>/)?.[1];
    // A Node upgrade silently invalidates the absolute path baked into the plist,
    // and the only symptom is a digest that quietly stops appearing.
    let nodeOk = false;
    try { await access(node); nodeOk = true; } catch {}
    if (!nodeOk) add('fail', 'Schedule', `plist points at a missing Node (${node}) — run: npm run agent:install`);
    else {
      const logPath = path.resolve('logs/agent.out.log');
      const s = await stat(logPath).catch(() => null);
      const since = s ? Date.now() - s.mtimeMs : null;
      if (!s) add('warn', 'Schedule', `${LABEL} installed but has never run`);
      else if (since > 48 * 3_600_000) add('warn', 'Schedule', `last run ${relAge(since)} — check logs/agent.err.log`);
      else add('ok', 'Schedule', `${LABEL}, last run ${relAge(since)}`);
    }
  } catch { add('warn', 'Schedule', 'not installed — run: npm run agent:install'); }

  // --- report ---------------------------------------------------------------
  const mark = { ok: '  ok  ', warn: ' warn ', fail: ' FAIL ' };
  const width = Math.max(...rows.map((r) => r.name.length));
  console.log('');
  for (const r of rows) console.log(`[${mark[r.state]}] ${r.name.padEnd(width)}  ${r.detail}`);
  const fails = rows.filter((r) => r.state === 'fail').length;
  const warns = rows.filter((r) => r.state === 'warn').length;
  console.log(`\n${rows.length - fails - warns} ok, ${warns} warning(s), ${fails} failure(s)\n`);
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
