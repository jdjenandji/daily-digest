import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { log, warn } from './lib/log.js';

const run = promisify(execFile);
const JOB_PREFIX = 'Daily Digest';

/**
 * Send the digest to a printer via CUPS.
 *
 * Printing never fails the digest. By the time this runs the PDF is already on disk,
 * so a printer problem is reported and the run still exits 0, the same way every data
 * source degrades to a labelled gap rather than taking the page down with it.
 */
export async function printFile(file, cfg, { dryRun = false } = {}) {
  const p = cfg.print ?? {};
  if (!p.enabled) return { ok: false, skipped: 'printing is disabled in config.json' };

  if (!p.printer) {
    // This Mac has no default destination, so a bare `lp` would fail with an opaque
    // CUPS error at 06:30. Name the queues instead.
    return {
      ok: false,
      error: `print.printer is not set in config.json. Available queues: ${
        (await queues()).map((q) => q.name).join(', ') || 'none'}`,
    };
  }

  const queue = (await queues()).find((q) => q.name === p.printer);
  if (!queue) {
    return {
      ok: false,
      error: `no printer named "${p.printer}". Available queues: ${
        (await queues()).map((q) => q.name).join(', ') || 'none'}`,
    };
  }
  if (!queue.enabled) {
    // A disabled queue accepts jobs and never prints them, so the job would sit there
    // silently forever. Better to refuse than to park it.
    return { ok: false, error: `printer "${p.printer}" is disabled; enable it with: cupsenable ${p.printer}` };
  }

  const title = `${JOB_PREFIX} ${path.basename(file, '.pdf').replace(/^daily-digest-/, '')}`;
  const args = ['-d', p.printer, '-t', title];
  // Options are passed on every job rather than trusted to the queue default: the
  // queues on this Mac default to Letter and the digest is A4.
  if (p.media) args.push('-o', `media=${p.media}`);
  if (p.sides) args.push('-o', `sides=${p.sides}`);
  if (p.colorMode) args.push('-o', `print-color-mode=${p.colorMode}`);
  for (const o of p.extraOptions ?? []) args.push('-o', o);
  args.push(file);

  if (dryRun) {
    log(`dry run, would print:\n  lp ${args.map(q => (/\s/.test(q) ? JSON.stringify(q) : q)).join(' ')}`);
    return { ok: true, dryRun: true, command: `lp ${args.join(' ')}` };
  }

  if (p.cancelPreviousJobs !== false) {
    const cancelled = await cancelOurStaleJobs(p.printer, title);
    if (cancelled.length) log(`cancelled ${cancelled.length} earlier digest job(s) still queued`);
  }

  try {
    const { stdout } = await run('lp', args, { timeout: 20_000 });
    // lp prints: request id is Printer-123 (1 file(s))
    const jobId = stdout.match(/request id is (\S+)/)?.[1] ?? null;
    return { ok: true, jobId, printer: p.printer, title };
  } catch (err) {
    return { ok: false, error: (err.stderr || err.message || '').trim() };
  }
}

/** Parse `lpstat -p` into {name, enabled, state}. */
export async function queues() {
  try {
    const { stdout } = await run('lpstat', ['-p'], { timeout: 10_000 });
    return stdout.split('\n').filter((l) => l.startsWith('printer ')).map((line) => {
      const name = line.split(' ')[1];
      return {
        name,
        // "disabled since ..." means the queue accepts jobs but will not print them.
        enabled: !/\bdisabled since\b/.test(line),
        state: /is (idle|printing|busy)/.exec(line)?.[1]
          ?? (/\bdisabled since\b/.test(line) ? 'disabled' : 'unknown'),
      };
    });
  } catch { return []; }
}

/** Jobs still queued for this printer, as {id, title}. */
export async function pendingJobs(printer) {
  try {
    const { stdout } = await run('lpstat', ['-o', printer], { timeout: 10_000 });
    return stdout.split('\n').filter(Boolean).map((line) => ({
      id: line.split(/\s+/)[0],
      line,
    }));
  } catch { return []; }
}

/**
 * Remove our own jobs left over from previous runs. Without this, a printer switched
 * off for a week prints the whole week the moment it comes back.
 */
async function cancelOurStaleJobs(printer, currentTitle) {
  const ours = (await pendingJobs(printer)).filter((j) => j.id.startsWith(`${printer}-`));
  const cancelled = [];
  for (const job of ours) {
    try { await run('cancel', [job.id], { timeout: 10_000 }); cancelled.push(job.id); }
    catch { warn(`could not cancel queued job ${job.id}`); }
  }
  return cancelled;
}
