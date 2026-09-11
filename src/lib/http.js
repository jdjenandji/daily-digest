// The single chokepoint for every outbound request: timeout, UA, retry policy.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with a hard timeout and one retry on transient failure.
 * A 404 is never retried: that is a config problem, not a blip.
 */
export async function get(url, {
  timeoutMs = 8000,
  accept = '*/*',
  retries = 1,
  headers = {},
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': UA,
          accept,
          'accept-language': 'en,de;q=0.8,fr;q=0.6',
          ...headers,
        },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        if (res.status === 404 || res.status === 401 || res.status === 403) throw err;
        lastErr = err;
        if (attempt < retries) { await sleep(800); continue; }
        throw err;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (err.status === 404 || err.status === 401 || err.status === 403) throw err;
      if (attempt < retries) { await sleep(800); continue; }
    }
  }
  throw lastErr ?? new Error('request failed');
}

export async function getText(url, opts = {}) {
  const res = await get(url, { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8', ...opts });
  return res.text();
}

export async function getJson(url, opts = {}) {
  const res = await get(url, { accept: 'application/json', ...opts });
  return res.json();
}

/** Run tasks at bounded concurrency with light spacing. Bursting is how you earn a 429. */
export async function pool(items, limit, spacingMs, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
      if (spacingMs) await sleep(spacingMs);
    }
  });
  await Promise.all(runners);
  return out;
}
