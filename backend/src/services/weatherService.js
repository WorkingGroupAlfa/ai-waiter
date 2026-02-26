const cache = new Map(); // key -> { expiresAt, value }

function cacheKey({ lat, lon }) {
  return `${lat.toFixed(4)}:${lon.toFixed(4)}`;
}

export async function getWeatherForRestaurant({ lat, lon, ttlSeconds = 600 }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const key = cacheKey({ lat, lon });
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  // Provider: open-meteo (без ключа)
  // current_weather=true даёт temp/windspeed/weathercode
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}&current_weather=true`;

  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;

    const data = await res.json();

    const cw = data?.current_weather;
    if (!cw) return null;

    // Нормализованный формат под payload
    const normalized = {
      provider: 'open-meteo',
      temperature_c: cw.temperature ?? null,
      windspeed_kmh: cw.windspeed ?? null,
      weather_code: cw.weathercode ?? null,
      observed_at: cw.time ?? null,
      fetched_at: new Date().toISOString(),
    };

    cache.set(key, {
      expiresAt: now + (Number(ttlSeconds) || 600) * 1000,
      value: normalized,
    });

    return normalized;
  } catch (e) {
    return null;
  }
}
