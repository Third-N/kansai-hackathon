export const hhmm = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min) % 60).padStart(2, "0")}`;

export const minutesNow = (d: Date = new Date()): number => d.getHours() * 60 + d.getMinutes();

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
export const jpDate = (d: Date = new Date()): string =>
  `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;

export const isoDate = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

export const signed = (n: number): string => (n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`);
