import { fetchWeather } from './sources/weather.js';
import { fetchMarkets } from './sources/markets.js';
import { fetchPredictions } from './sources/predictions.js';
import { fetchNews, sources as newsSources } from './sources/news.js';
import { fetchCalendar } from './sources/calendar.js';
import { fetchPoem } from './sources/poem.js';
import { fetchImage } from './sources/image.js';
import { fetchAnnouncements } from './sources/announcements.js';
import { grade } from './lib/result.js';
import { dayBounds } from './config.js';

/**
 * Collect every source in parallel. Nothing here can throw: each source already
 * converts its own failures into a result envelope, so the model is always renderable
 * and the PDF is always produced.
 */
export async function collect(cfg) {
  const startedAt = Date.now();
  const tz = cfg.location.timezone;
  const { ymd } = dayBounds(tz);

  const budget = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('overall time budget exceeded')), cfg.timeouts.totalMs).unref?.());

  const work = Promise.all([
    fetchWeather(cfg),
    fetchCalendar(cfg),
    fetchMarkets(cfg),
    fetchPredictions(cfg),
    fetchNews(cfg),
    fetchPoem(cfg),
    fetchImage(cfg, 'meme'),
    fetchAnnouncements(cfg),
  ]);

  let weather, calendar, markets, predictions, news, poem, meme, announcements;
  try {
    [weather, calendar, markets, predictions, news, poem, meme, announcements] = await Promise.race([work, budget]);
  } catch {
    // Budget blown: take whatever has resolved rather than producing nothing.
    [weather, calendar, markets, predictions, news, poem, meme, announcements] = await Promise.all([
      Promise.resolve(weather).catch(() => null),
      Promise.resolve(calendar).catch(() => null),
      Promise.resolve(markets).catch(() => null),
      Promise.resolve(predictions).catch(() => null),
      Promise.resolve(news).catch(() => []),
      Promise.resolve(poem).catch(() => null),
      Promise.resolve(meme).catch(() => null),
      Promise.resolve(announcements).catch(() => null),
    ]);
  }

  const enabledNews = newsSources(cfg);

  const statuses = [
    { id: 'weather', label: cfg.location.label, state: grade(weather) },
    { id: 'calendar', label: 'Calendar', state: calendar?.data?.notice ? 'stale' : grade(calendar) },
    { id: 'markets', label: 'Markets', state: markets?.data?.degraded ? 'stale' : grade(markets) },
    { id: 'predictions', label: 'Predictions', state: grade(predictions) },
    ...(poem?.data ? [{ id: 'poem', label: 'Poem', state: grade(poem) }] : []),
    ...(meme?.data ? [{ id: 'meme', label: cfg.meme?.label ?? 'Meme', state: grade(meme) }] : []),
    ...(announcements?.data ? [{ id: 'announcements',
      label: cfg.announcements?.label ?? 'Announcements', state: grade(announcements) }] : []),
    // Index against the ENABLED sources, not cfg.news: a disabled paper shifts every
    // later index and would silently attach the wrong name to the wrong feed.
    ...(news ?? []).map((r, i) => ({
      id: r.id,
      label: enabledNews[i]?.name ?? r.id,
      state: grade(r),
    })),
  ];

  return {
    ymd,
    timezone: tz,
    generatedAt: Date.now(),
    tookMs: Date.now() - startedAt,
    location: cfg.location,
    weather,
    calendar,
    markets,
    predictions,
    news: (news ?? []).map((r, i) => ({
      ...r,
      name: enabledNews[i]?.name ?? r.id,
      // Which page this source belongs on. Defaults to the newspapers.
      page: enabledNews[i]?.page ?? 'papers',
    })),
    poem,
    meme,
    announcements,
    memeMaxHeightMm: cfg.meme?.maxHeightMm,
    announcementsLabel: cfg.announcements?.label,
    statuses,
    degraded: statuses.filter((s) => s.state !== 'ok'),
  };
}
