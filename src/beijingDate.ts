const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export type BeijingClock = {
  year: number;
  month: number;
  day: number;
  nowMs: number;
};

export function beijingClock(nowMs = Date.now()): BeijingClock {
  const date = new Date(nowMs + BEIJING_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    nowMs
  };
}

export function beijingDateToIso(year: number, month: number, day: number, hour: number, minute: number) {
  if (![year, month, day, hour, minute].every(Number.isInteger)
    || year < 1000 || year > 9999
    || month < 1 || month > 12
    || day < 1 || day > 31
    || hour < 0 || hour > 23
    || minute < 0 || minute > 59) {
    return '';
  }
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - BEIJING_OFFSET_MS;
  const roundTrip = new Date(utcMs + BEIJING_OFFSET_MS);
  if (roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() + 1 !== month
    || roundTrip.getUTCDate() !== day
    || roundTrip.getUTCHours() !== hour
    || roundTrip.getUTCMinutes() !== minute) {
    return '';
  }
  return new Date(utcMs).toISOString();
}

export function mostRecentBeijingDateToIso(
  month: number,
  day: number,
  hour: number,
  minute: number,
  nowMs = Date.now()
) {
  if (!Number.isFinite(nowMs)) {
    return '';
  }
  const now = beijingClock(nowMs);
  for (let year = now.year; year >= now.year - 8; year -= 1) {
    const candidate = beijingDateToIso(year, month, day, hour, minute);
    if (candidate && Date.parse(candidate) <= nowMs) {
      return candidate;
    }
  }
  return '';
}
