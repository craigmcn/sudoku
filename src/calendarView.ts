import type { Difficulty } from './generator';
import type { UserPlay } from './stats';

export type DayCompletion = 'not-completed' | 'completed';

export interface CalendarDay {
  date: string; // 'yyyy-mm-dd'
  day: number; // 1-31
  inCurrentMonth: boolean; // false for leading/trailing padding cells
  selectable: boolean; // inCurrentMonth && minDate <= date <= today
  status: DayCompletion | 'unavailable'; // 'unavailable' whenever !selectable
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// yyyy-mm-dd from UTC calendar fields, matching todayUtc()'s convention.
function toDateString(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

// yyyy-mm-dd is lexicographically comparable, so plain string comparison
// gives correct date ordering without parsing into Date objects.
export function isDateSelectable(
  date: string,
  today: string,
  minDate: string,
): boolean {
  return date >= minDate && date <= today;
}

export function selectableDatesInMonth(
  year: number,
  month: number,
  today: string,
  minDate: string,
): string[] {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dates: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = toDateString(year, month, day);
    if (isDateSelectable(date, today, minDate)) dates.push(date);
  }
  return dates;
}

// Always 42 entries (6-week grid, Sunday-start), so the grid's row count
// never shifts between months as it's rendered.
export function buildCalendarMonth(
  year: number,
  month: number,
  today: string,
  minDate: string,
  completedDates: ReadonlySet<string>,
): CalendarDay[] {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const startWeekday = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const daysInPrevMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: CalendarDay[] = [];

  for (let i = 0; i < startWeekday; i++) {
    const day = daysInPrevMonth - startWeekday + 1 + i;
    const { year: y, month: m } = shiftMonth(year, month, -1);
    cells.push({
      date: toDateString(y, m, day),
      day,
      inCurrentMonth: false,
      selectable: false,
      status: 'unavailable',
    });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = toDateString(year, month, day);
    const selectable = isDateSelectable(date, today, minDate);
    cells.push({
      date,
      day,
      inCurrentMonth: true,
      selectable,
      status: selectable
        ? completedDates.has(date)
          ? 'completed'
          : 'not-completed'
        : 'unavailable',
    });
  }

  const remaining = 42 - cells.length;
  for (let day = 1; day <= remaining; day++) {
    const { year: y, month: m } = shiftMonth(year, month, 1);
    cells.push({
      date: toDateString(y, m, day),
      day,
      inCurrentMonth: false,
      selectable: false,
      status: 'unavailable',
    });
  }

  return cells;
}

export function canGoToPreviousMonth(
  year: number,
  month: number,
  minDate: string,
): boolean {
  const daysInPrevMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const { year: y, month: m } = shiftMonth(year, month, -1);
  const lastDateOfPrevMonth = toDateString(y, m, daysInPrevMonth);
  return lastDateOfPrevMonth >= minDate;
}

export function canGoToNextMonth(
  year: number,
  month: number,
  today: string,
): boolean {
  const { year: y, month: m } = shiftMonth(year, month, 1);
  const firstDateOfNextMonth = toDateString(y, m, 1);
  return firstDateOfNextMonth <= today;
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

export function difficultiesWithCompletions(
  plays: UserPlay[],
): Set<Difficulty> {
  return new Set(plays.map((p) => p.difficulty));
}
