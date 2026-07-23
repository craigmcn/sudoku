import { describe, expect, it } from 'vitest';
import type { UserPlay } from './stats';
import {
  buildCalendarMonth,
  canGoToNextMonth,
  canGoToPreviousMonth,
  difficultiesWithCompletions,
  formatMonthLabel,
  isDateSelectable,
  selectableDatesInMonth,
  shiftMonth,
} from './calendarView';

const MIN_DATE = '2026-07-17';

function play(overrides: Partial<UserPlay> = {}): UserPlay {
  return {
    puzzleId: 'abc',
    difficulty: 'easy',
    mistakes: 0,
    elapsedMs: 60_000,
    completedAt: new Date('2026-07-21T00:00:00Z'),
    ...overrides,
  };
}

describe('isDateSelectable', () => {
  it('accepts dates within [minDate, today]', () => {
    expect(isDateSelectable('2026-07-20', '2026-07-23', MIN_DATE)).toBe(true);
    expect(isDateSelectable(MIN_DATE, '2026-07-23', MIN_DATE)).toBe(true);
    expect(isDateSelectable('2026-07-23', '2026-07-23', MIN_DATE)).toBe(true);
  });

  it('rejects dates before minDate or after today', () => {
    expect(isDateSelectable('2026-07-16', '2026-07-23', MIN_DATE)).toBe(false);
    expect(isDateSelectable('2026-07-24', '2026-07-23', MIN_DATE)).toBe(false);
  });
});

describe('selectableDatesInMonth', () => {
  it('returns only in-range dates for a month straddling both boundaries', () => {
    // July 2026: minDate cuts off before the 17th, today (7/20) cuts off after.
    const dates = selectableDatesInMonth(2026, 6, '2026-07-20', MIN_DATE);
    expect(dates[0]).toBe('2026-07-17');
    expect(dates[dates.length - 1]).toBe('2026-07-20');
    expect(dates).toHaveLength(4);
  });

  it('returns every day for a month fully within range', () => {
    const dates = selectableDatesInMonth(2026, 7, '2026-09-30', MIN_DATE);
    expect(dates).toHaveLength(31);
  });
});

describe('buildCalendarMonth', () => {
  it('always returns a 42-cell grid', () => {
    const cells = buildCalendarMonth(
      2026,
      6,
      '2026-07-23',
      MIN_DATE,
      new Set(),
    );
    expect(cells).toHaveLength(42);
  });

  it('marks padding cells from adjacent months as unavailable and not selectable', () => {
    const cells = buildCalendarMonth(
      2026,
      6,
      '2026-07-23',
      MIN_DATE,
      new Set(),
    );
    const padding = cells.filter((c) => !c.inCurrentMonth);
    expect(padding.length).toBeGreaterThan(0);
    for (const cell of padding) {
      expect(cell.selectable).toBe(false);
      expect(cell.status).toBe('unavailable');
    }
  });

  it('marks days before MIN_CALENDAR_DATE as unavailable, not not-completed', () => {
    const cells = buildCalendarMonth(
      2026,
      6,
      '2026-07-23',
      MIN_DATE,
      new Set(),
    );
    const july16 = cells.find((c) => c.date === '2026-07-16');
    expect(july16?.inCurrentMonth).toBe(true);
    expect(july16?.selectable).toBe(false);
    expect(july16?.status).toBe('unavailable');
  });

  it('marks days after today (but still in the same month) as unavailable', () => {
    const cells = buildCalendarMonth(
      2026,
      6,
      '2026-07-20',
      MIN_DATE,
      new Set(),
    );
    const july23 = cells.find((c) => c.date === '2026-07-23');
    expect(july23?.inCurrentMonth).toBe(true);
    expect(july23?.selectable).toBe(false);
    expect(july23?.status).toBe('unavailable');
  });

  it('marks selectable days as completed or not-completed based on the provided set', () => {
    const cells = buildCalendarMonth(
      2026,
      6,
      '2026-07-23',
      MIN_DATE,
      new Set(['2026-07-18']),
    );
    const completed = cells.find((c) => c.date === '2026-07-18');
    const notCompleted = cells.find((c) => c.date === '2026-07-19');
    expect(completed?.status).toBe('completed');
    expect(notCompleted?.status).toBe('not-completed');
  });
});

describe('canGoToPreviousMonth / canGoToNextMonth', () => {
  it('disables previous month once the month before has no selectable dates', () => {
    // July 2026 (month index 6) contains MIN_DATE, so June 2026 is fully before it.
    expect(canGoToPreviousMonth(2026, 6, MIN_DATE)).toBe(false);
    expect(canGoToPreviousMonth(2026, 7, MIN_DATE)).toBe(true);
  });

  it('disables next month once the month after is entirely in the future', () => {
    const today = '2026-07-23';
    expect(canGoToNextMonth(2026, 6, today)).toBe(false);
    expect(canGoToNextMonth(2026, 5, today)).toBe(true);
  });
});

describe('shiftMonth', () => {
  it('shifts within a year', () => {
    expect(shiftMonth(2026, 6, 1)).toEqual({ year: 2026, month: 7 });
    expect(shiftMonth(2026, 6, -1)).toEqual({ year: 2026, month: 5 });
  });

  it('rolls over into the next/previous year', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
});

describe('formatMonthLabel', () => {
  it('formats a human-readable month/year label', () => {
    expect(formatMonthLabel(2026, 6)).toBe('July 2026');
    expect(formatMonthLabel(2026, 0)).toBe('January 2026');
  });
});

describe('difficultiesWithCompletions', () => {
  it('returns an empty set for no plays', () => {
    expect(difficultiesWithCompletions([])).toEqual(new Set());
  });

  it('deduplicates repeated difficulties', () => {
    const plays = [
      play({ difficulty: 'easy' }),
      play({ difficulty: 'easy' }),
      play({ difficulty: 'hard' }),
    ];
    expect(difficultiesWithCompletions(plays)).toEqual(
      new Set(['easy', 'hard']),
    );
  });
});
