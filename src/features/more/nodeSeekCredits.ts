import type { NodeSeekCreditEntry } from '@/domain/forum/accountData';

export function creditDayKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export type CreditDay = {
  day: string;
  income: number;
  expense: number;
  net: number;
  attendanceIncome: number;
  complete: boolean;
  entries: NodeSeekCreditEntry[];
};

export function summarizeCredits({
  entries,
  hasMore,
  loaded,
  consistent = true,
  now = new Date()
}: {
  entries: readonly NodeSeekCreditEntry[];
  hasMore: boolean;
  loaded: boolean;
  consistent?: boolean;
  now?: Date;
}) {
  const groups = new Map<string, CreditDay>();
  for (const entry of entries) {
    const day = creditDayKey(new Date(entry.createdAt));
    let group = groups.get(day);
    if (!group) {
      group = { day, income: 0, expense: 0, net: 0, attendanceIncome: 0, complete: false, entries: [] };
      groups.set(day, group);
    }
    group.entries.push(entry);
    group.income += Math.max(0, entry.change);
    group.expense += Math.max(0, -entry.change);
    group.net += entry.change;
    if (entry.change > 0 && entry.reason.startsWith('签到收益')) group.attendanceIncome += entry.change;
  }
  const days = [...groups.values()].sort((a, b) => b.day.localeCompare(a.day));
  const ordered = entries.every(
    (entry, index) => index === 0 || Date.parse(entries[index - 1].createdAt) >= Date.parse(entry.createdAt)
  );
  const oldestDay = days.at(-1)?.day;
  for (const day of days) day.complete = loaded && consistent && (!hasMore || (ordered && day.day !== oldestDay));
  const todayKey = creditDayKey(now);
  const today = groups.get(todayKey) ?? {
    day: todayKey,
    income: 0,
    expense: 0,
    net: 0,
    attendanceIncome: 0,
    complete: false,
    entries: []
  };
  today.complete = loaded && consistent && (!hasMore || (ordered && oldestDay !== undefined && oldestDay < todayKey));
  return { today, days, ordered, consistent };
}
