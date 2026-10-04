export const TIMEZONE = 'Pacific/Auckland';
export function today(now = new Date(), timezone = TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function addDays(day: string, count: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + count * 86400000).toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number { return Math.round((Date.parse(a) - Date.parse(b)) / 86400000); }
export function weekday(day: string): number { return (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7; }
export function labelDate(day: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'numeric' }): string {
  return new Intl.DateTimeFormat('vi-VN', { ...options, timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'));
}
