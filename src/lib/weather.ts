import { addDays, today } from './dates';
import { AppError } from './validation';
import type { Context, Weather } from './types';
export async function loadWeather(context: Context, fetcher: typeof fetch = fetch): Promise<Weather> {
  if (context.start < today() || context.end > addDays(today(), 15)) throw new AppError(400, 'AI chỉ lập lịch trong phạm vi dự báo 16 ngày.');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: String(context.garden.latitude), longitude: String(context.garden.longitude), timezone: context.garden.timezone,
    start_date: context.start, end_date: context.end,
    daily: 'precipitation_sum,precipitation_probability_max,temperature_2m_max,wind_speed_10m_max,et0_fao_evapotranspiration' }).toString();
  let response: Response;
  try { response = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
  catch { throw new AppError(502, 'Không lấy được thời tiết. Thử lại hoặc chọn Theo lịch sử.', 'WEATHER_UNAVAILABLE'); }
  if (!response.ok) throw new AppError(502, 'Dịch vụ thời tiết chưa đáp ứng. Thử lại hoặc chọn Theo lịch sử.', 'WEATHER_UNAVAILABLE');
  const json = await response.json();
  const daily = json.daily;
  const keys = ['precipitation_sum', 'precipitation_probability_max', 'temperature_2m_max', 'wind_speed_10m_max'];
  if (!daily || !Array.isArray(daily.time) || daily.time.length !== 7 || keys.some(key => !Array.isArray(daily[key]) || daily[key].length !== 7)) throw new AppError(502, 'Dự báo thiếu dữ liệu 7 ngày.', 'WEATHER_INCOMPLETE');
  const days = daily.time.map((day: string, i: number) => {
    if (day !== addDays(context.start, i) || keys.some(key => typeof daily[key][i] !== 'number' || !Number.isFinite(daily[key][i]))) throw new AppError(502, 'Dự báo không đủ dữ liệu hợp lệ.', 'WEATHER_INCOMPLETE');
    return { date: day, rainMm: daily.precipitation_sum[i], rainProbability: daily.precipitation_probability_max[i], maxTemp: daily.temperature_2m_max[i], windKmh: daily.wind_speed_10m_max[i], et0: daily.et0_fao_evapotranspiration?.[i] ?? null };
  });
  return { source: 'Open-Meteo', fetchedAt: new Date().toISOString(), days };
}
