// A uniform envelope for every source. Nothing throws past the source boundary.

export function ok(id, data, { fromCache = false, fetchedAt = Date.now(), note = null } = {}) {
  return { id, ok: true, data, fetchedAt, fromCache, note, error: null };
}

export function fail(id, err, { note = null } = {}) {
  const message = err instanceof Error ? err.message : String(err);
  return { id, ok: false, data: null, fetchedAt: null, fromCache: false, note, error: message };
}

/** Run a source function, converting any throw into a failed result. */
export async function attempt(id, fn) {
  try {
    return await fn();
  } catch (err) {
    return fail(id, err);
  }
}

/**
 * Grade a result for the footer status strip.
 * Returns 'ok' | 'stale' | 'cached' | 'failed'.
 */
export function grade(result) {
  if (!result || !result.ok) return 'failed';
  if (result.data?.stale) return 'stale';
  if (result.fromCache) return 'cached';
  return 'ok';
}
