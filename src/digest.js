import { fetchWeather } from './sources/weather.js';
import { fetchMarkets } from './sources/markets.js';
import { fetchNews } from './sources/news.js';
import { fetchCalendar } from './sources/calendar.js';
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
    fetchNews(cfg),
  ]);

  let weather, calendar, markets, news;
  try {
    [weather, calendar, markets, news] = await Promise.race([work, budget]);
  } catch {
    // Budget blown: take whatever has resolved rather than producing nothing.
    [weather, calendar, markets, news] = await Promise.all([
      Promise.resolve(weather).catch(() => null),
      Promise.resolve(calendar).catch(() => null),
      Promise.resolve(markets).catch(() => null),
      Promise.resolve(news).catch(() => []),
    ]);
  }

  const statuses = [
    { id: 'weather', label: cfg.location.label, state: grade(weather) },
    { id: 'calendar', label: 'Calendar', state: calendar?.data?.notice ? 'stale' : grade(calendar) },
    { id: 'markets', label: 'Markets', state: markets?.data?.degraded ? 'stale' : grade(markets) },
    ...(news ?? []).map((r, i) => ({
      id: r.id,
      label: cfg.news[i]?.name ?? r.id,
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
    news: (news ?? []).map((r, i) => ({ ...r, name: cfg.news[i]?.name ?? r.id })),
    statuses,
    degraded: statuses.filter((s) => s.state !== 'ok'),
  };
}
