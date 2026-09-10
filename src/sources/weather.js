import { getJson } from '../lib/http.js';
import * as cache from '../lib/cache.js';
import { ok, fail } from '../lib/result.js';

// WMO weather codes -> label plus an icon key the template maps to inline SVG.
const WMO = {
  0: ['Clear sky', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'partly'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'], 48: ['Rime fog', 'fog'],
  51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'sleet'], 57: ['Freezing drizzle', 'sleet'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'sleet'], 67: ['Freezing rain', 'sleet'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Rain showers', 'showers'], 81: ['Rain showers', 'showers'], 82: ['Violent showers', 'showers'],
  85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm, hail', 'storm'], 99: ['Thunderstorm, hail', 'storm'],
};
export const describe = (code) => WMO[code] ?? ['—', 'cloud'];

const ID = 'weather';

export async function fetchWeather(cfg) {
  const { latitude, longitude, timezone, label } = cfg.location;
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${latitude}&longitude=${longitude}`
    + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset'
    + '&hourly=temperature_2m,precipitation_probability,weather_code'
    + `&forecast_days=1&timezone=${encodeURIComponent(timezone)}`;

  try {
    const raw = await getJson(url, { timeoutMs: cfg.timeouts.weatherMs });
    const data = shape(raw, label);
    await cache.write(ID, data);
    return ok(ID, data);
  } catch (err) {
    const stale = await cache.readStale(ID, cfg.cache.weatherMaxStaleHours);
    if (stale) return ok(ID, stale.data, { fromCache: true, fetchedAt: stale.fetchedAt });
    return fail(ID, err);
  }
}

function shape(raw, label) {
  const [nowLabel, nowIcon] = describe(raw.current?.weather_code);
  const [dayLabel, dayIcon] = describe(raw.daily?.weather_code?.[0]);

  // Three representative points rather than a 24-row table.
  const hours = raw.hourly?.time ?? [];
  const pick = (h) => {
    const i = hours.findIndex((t) => Number(t.slice(11, 13)) === h);
    return i < 0 ? null : {
      hour: h,
      temp: raw.hourly.temperature_2m?.[i],
      precip: raw.hourly.precipitation_probability?.[i],
    };
  };

  return {
    label,
    now: {
      temp: raw.current?.temperature_2m,
      feels: raw.current?.apparent_temperature,
      humidity: raw.current?.relative_humidity_2m,
      wind: raw.current?.wind_speed_10m,
      label: nowLabel, icon: nowIcon,
      observedAt: raw.current?.time,
    },
    today: {
      label: dayLabel, icon: dayIcon,
      max: raw.daily?.temperature_2m_max?.[0],
      min: raw.daily?.temperature_2m_min?.[0],
      precipChance: raw.daily?.precipitation_probability_max?.[0],
      precipSum: raw.daily?.precipitation_sum?.[0],
      sunrise: raw.daily?.sunrise?.[0],
      sunset: raw.daily?.sunset?.[0],
    },
    slots: [pick(8), pick(14), pick(20)].filter(Boolean),
  };
}
