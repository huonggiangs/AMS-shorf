// Thoi tiet tu Open-Meteo (mien phi, khong can khoa): GPS trinh duyet hoac toa do co dinh.
export interface WeatherCfg { mode: 'gps' | 'fixed'; lat?: number; lon?: number; label?: string }
export interface WeatherNow { temp: number; code: number; humidity: number; wind: number }

export const CITIES: { label: string; lat: number; lon: number }[] = [
  { label: 'Hà Nội', lat: 21.0285, lon: 105.8542 }, { label: 'TP. Hồ Chí Minh', lat: 10.8231, lon: 106.6297 }, { label: 'Đà Nẵng', lat: 16.0544, lon: 108.2022 },
  { label: 'Hải Phòng', lat: 20.8449, lon: 106.6881 }, { label: 'Cần Thơ', lat: 10.0452, lon: 105.7469 }, { label: 'Nha Trang', lat: 12.2388, lon: 109.1967 },
  { label: 'Huế', lat: 16.4637, lon: 107.5909 }, { label: 'Đà Lạt', lat: 11.9404, lon: 108.4583 },
];
export const DEFAULT_CITY = CITIES[0]!;

export function weatherUrl(lat: number, lon: number): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&timezone=auto`;
}

export async function fetchWeather(lat: number, lon: number, signal?: AbortSignal): Promise<WeatherNow> {
  const r = await fetch(weatherUrl(lat, lon), { signal: signal ?? null });
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const j = (await r.json()) as { current?: { temperature_2m?: number; weather_code?: number; relative_humidity_2m?: number; wind_speed_10m?: number } };
  const c = j.current;
  if (!c || typeof c.temperature_2m !== 'number') throw new Error('Không có dữ liệu thời tiết');
  return { temp: c.temperature_2m, code: c.weather_code ?? 0, humidity: c.relative_humidity_2m ?? 0, wind: c.wind_speed_10m ?? 0 };
}

/** Bieu tuong + mo ta theo WMO weather_code. */
export function weatherInfo(code: number): { icon: string; text: string } {
  if (code === 0) return { icon: '☀️', text: 'Trời quang' };
  if (code <= 2) return { icon: '⛅', text: 'Ít mây' };
  if (code === 3) return { icon: '☁️', text: 'Nhiều mây' };
  if (code === 45 || code === 48) return { icon: '🌫️', text: 'Sương mù' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', text: 'Mưa phùn' };
  if (code >= 61 && code <= 67) return { icon: '🌧️', text: 'Mưa' };
  if (code >= 71 && code <= 77) return { icon: '❄️', text: 'Tuyết' };
  if (code >= 80 && code <= 82) return { icon: '🌧️', text: 'Mưa rào' };
  if (code >= 95) return { icon: '⛈️', text: 'Dông' };
  return { icon: '🌡️', text: 'Thời tiết' };
}

/** Toa do dung de lay thoi tiet: gps -> vi tri trinh duyet (hoi lan dau), loi/tu choi thi dung toa do luu san hoac Ha Noi. */
export function resolveCoords(cfg: WeatherCfg | undefined, gps: { lat: number; lon: number } | null): { lat: number; lon: number; label: string } {
  if (cfg?.mode === 'gps' && gps) return { ...gps, label: cfg.label || 'Vị trí của bạn' };
  const lat = cfg?.lat ?? DEFAULT_CITY.lat;
  const lon = cfg?.lon ?? DEFAULT_CITY.lon;
  return { lat, lon, label: cfg?.label || (cfg?.lat === undefined ? DEFAULT_CITY.label : 'Tọa độ đã chọn') };
}

export function getGps(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new Error('Trình duyệt không hỗ trợ định vị.'));
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), (e) => reject(new Error(e.message || 'Không lấy được vị trí.')), { timeout: 8000, maximumAge: 600_000 });
  });
}
