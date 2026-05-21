/**
 * Payment Date Calculator
 * Handles payment scheduling with US holidays and weekend detection
 */

import { addDays, getDay, getMonth, getYear, isWeekend, format, startOfDay, isBefore } from 'date-fns';

export type PaymentFrequency = 'weekly' | 'biweekly' | 'monthly';

// US Federal Holidays (fixed dates and calculated dates)
interface Holiday {
  name: string;
  month: number; // 0-indexed
  day?: number; // For fixed date holidays
  weekOfMonth?: number; // For nth weekday holidays (1-5, where 5 = last)
  dayOfWeek?: number; // 0 = Sunday, 1 = Monday, etc.
}

const US_HOLIDAYS: Holiday[] = [
  { name: "New Year's Day", month: 0, day: 1 },
  { name: "Martin Luther King Jr. Day", month: 0, weekOfMonth: 3, dayOfWeek: 1 }, // 3rd Monday of January
  { name: "Presidents' Day", month: 1, weekOfMonth: 3, dayOfWeek: 1 }, // 3rd Monday of February
  { name: "Memorial Day", month: 4, weekOfMonth: 5, dayOfWeek: 1 }, // Last Monday of May
  { name: "Juneteenth", month: 5, day: 19 },
  { name: "Independence Day", month: 6, day: 4 },
  { name: "Labor Day", month: 8, weekOfMonth: 1, dayOfWeek: 1 }, // 1st Monday of September
  { name: "Columbus Day", month: 9, weekOfMonth: 2, dayOfWeek: 1 }, // 2nd Monday of October
  { name: "Veterans Day", month: 10, day: 11 },
  { name: "Thanksgiving", month: 10, weekOfMonth: 4, dayOfWeek: 4 }, // 4th Thursday of November
  { name: "Christmas Day", month: 11, day: 25 },
];

/**
 * Get the nth occurrence of a day of week in a month
 */
function getNthDayOfMonth(year: number, month: number, dayOfWeek: number, n: number): Date {
  const firstDay = new Date(year, month, 1);
  const firstDayOfWeek = getDay(firstDay);

  // Calculate the date of the first occurrence of the day of week
  const firstOccurrence = 1 + ((dayOfWeek - firstDayOfWeek + 7) % 7);

  // If n is 5, we want the last occurrence
  if (n === 5) {
    // Get the last day of the month
    const lastDay = new Date(year, month + 1, 0).getDate();
    let lastOccurrence = firstOccurrence;
    while (lastOccurrence + 7 <= lastDay) {
      lastOccurrence += 7;
    }
    return new Date(year, month, lastOccurrence);
  }

  // Calculate the nth occurrence
  const date = firstOccurrence + (n - 1) * 7;
  return new Date(year, month, date);
}

/**
 * Get all US holidays for a given year
 */
export function getUSHolidays(year: number): Date[] {
  const holidays: Date[] = [];

  for (const holiday of US_HOLIDAYS) {
    let date: Date;

    if (holiday.day !== undefined) {
      // Fixed date holiday
      date = new Date(year, holiday.month, holiday.day);

      // If it falls on Saturday, observe on Friday
      // If it falls on Sunday, observe on Monday
      if (getDay(date) === 6) {
        date = addDays(date, -1); // Friday
      } else if (getDay(date) === 0) {
        date = addDays(date, 1); // Monday
      }
    } else if (holiday.weekOfMonth !== undefined && holiday.dayOfWeek !== undefined) {
      // Nth weekday holiday
      date = getNthDayOfMonth(year, holiday.month, holiday.dayOfWeek, holiday.weekOfMonth);
    } else {
      continue;
    }

    holidays.push(startOfDay(date));
  }

  return holidays;
}

/**
 * Check if a date is a US holiday
 */
export function isUSHoliday(date: Date): boolean {
  const year = getYear(date);
  const holidays = getUSHolidays(year);
  const dateStr = format(date, 'yyyy-MM-dd');

  return holidays.some(h => format(h, 'yyyy-MM-dd') === dateStr);
}

/**
 * Check if a date is a business day (not weekend or holiday)
 */
export function isBusinessDay(date: Date): boolean {
  return !isWeekend(date) && !isUSHoliday(date);
}

/**
 * Get the next business day (skips weekends and US holidays)
 */
export function getNextBusinessDay(date: Date): Date {
  let nextDay = startOfDay(date);

  while (!isBusinessDay(nextDay)) {
    nextDay = addDays(nextDay, 1);
  }

  return nextDay;
}

interface PaymentConfig {
  frequency: PaymentFrequency;
  paymentDay?: number | null; // For weekly (0-6) or monthly (1-31)
  biweeklyFirstDay?: number | null; // First payment day for biweekly
  biweeklySecondDay?: number | null; // Second payment day for biweekly
}

/**
 * Build candidate RAW scheduled dates around today, spanning enough cycles
 * back and forward that we always cover the immediate previous + next slot.
 * Used by both calculateNextPaymentDate and calculatePreviousPaymentDate.
 */
function buildScheduledCandidates(
  frequency: PaymentFrequency,
  paymentDay: number | null,
  today: Date,
  biweeklyFirstDay?: number | null,
  biweeklySecondDay?: number | null
): Date[] {
  const candidates: Date[] = [];

  switch (frequency) {
    case 'weekly': {
      const targetDay = paymentDay ?? 5;
      for (let offset = -14; offset <= 14; offset++) {
        const candidate = addDays(today, offset);
        if (getDay(candidate) === targetDay) {
          candidates.push(startOfDay(candidate));
        }
      }
      break;
    }
    case 'biweekly': {
      const firstDay = biweeklyFirstDay ?? 1;
      const secondDay = biweeklySecondDay ?? 16;
      const y = getYear(today);
      const m = getMonth(today);
      for (let monthOffset = -1; monthOffset <= 1; monthOffset++) {
        candidates.push(new Date(y, m + monthOffset, firstDay));
        candidates.push(new Date(y, m + monthOffset, secondDay));
      }
      break;
    }
    case 'monthly': {
      const monthlyDay = paymentDay ?? 1;
      const y = getYear(today);
      const m = getMonth(today);
      for (let monthOffset = -1; monthOffset <= 1; monthOffset++) {
        candidates.push(new Date(y, m + monthOffset, monthlyDay));
      }
      break;
    }
  }

  return candidates;
}

/**
 * Calculate the next payment date based on frequency.
 *
 * Compares against BUSINESS-DAY-ADJUSTED candidate dates, not raw ones.
 * This fixes the bug where a biweekly account with second_day=16 and
 * today=Sunday May 17 would skip past May 16 (Saturday) → June 1, even
 * though the actual payment day was May 18 (Monday adjusted from May 16)
 * which is still in the future.
 */
export function calculateNextPaymentDate(
  frequency: PaymentFrequency,
  paymentDay: number | null,
  fromDate: Date = new Date(),
  biweeklyFirstDay?: number | null,
  biweeklySecondDay?: number | null
): Date {
  const today = startOfDay(fromDate);
  const candidates = buildScheduledCandidates(
    frequency,
    paymentDay,
    today,
    biweeklyFirstDay,
    biweeklySecondDay
  );

  // Adjust each candidate to its business-day-of-record, sort ascending,
  // and return the smallest that is >= today.
  const adjusted = candidates
    .map(c => getNextBusinessDay(c))
    .sort((a, b) => a.getTime() - b.getTime());

  for (const date of adjusted) {
    if (!isBefore(date, today)) return date;
  }
  return adjusted[adjusted.length - 1] || today;
}

/**
 * Calculate the most recent SCHEDULED payment date before today.
 *
 * Used to detect missed cycles: if `daysSincePrevious` is small and no
 * payment was recorded for that period, the account is overdue. Returns
 * the same business-day-adjusted date that the user would have seen in
 * their reminder, so the 'Was due' message stays consistent.
 */
/**
 * Window around a scheduled cycle date in which a payment is considered
 * to "belong to" that cycle. Used so that a late cycle-1 payment doesn't
 * get mistakenly credited as a cycle-2 payment just because it happened
 * to fall inside a fixed lookback window.
 *
 * Window = ±half-cycle around the cycle date. For weekly = ±3.5 days,
 * biweekly = ±7 days, monthly = ±15 days.
 */
export function getCycleWindow(
  cycleDate: Date,
  frequency: PaymentFrequency
): { start: Date; end: Date } {
  const halfCycleDays = frequency === 'weekly' ? 3.5 : frequency === 'biweekly' ? 7 : 15;
  const halfMs = halfCycleDays * 24 * 60 * 60 * 1000;
  return {
    start: new Date(cycleDate.getTime() - halfMs),
    end: new Date(cycleDate.getTime() + halfMs),
  };
}

export function calculatePreviousPaymentDate(
  frequency: PaymentFrequency,
  paymentDay: number | null,
  fromDate: Date = new Date(),
  biweeklyFirstDay?: number | null,
  biweeklySecondDay?: number | null
): Date {
  const today = startOfDay(fromDate);
  const candidates = buildScheduledCandidates(
    frequency,
    paymentDay,
    today,
    biweeklyFirstDay,
    biweeklySecondDay
  );

  const adjusted = candidates
    .map(c => getNextBusinessDay(c))
    .sort((a, b) => b.getTime() - a.getTime());

  for (const date of adjusted) {
    if (isBefore(date, today)) return date;
  }
  return adjusted[0] || today;
}

/**
 * Get all upcoming payment dates for the next N occurrences
 */
export function getUpcomingPaymentDates(
  frequency: PaymentFrequency,
  paymentDay: number | null,
  count: number = 4,
  fromDate: Date = new Date(),
  biweeklyFirstDay?: number | null,
  biweeklySecondDay?: number | null
): Date[] {
  const dates: Date[] = [];
  let currentDate = fromDate;

  for (let i = 0; i < count; i++) {
    const nextPayment = calculateNextPaymentDate(frequency, paymentDay, currentDate, biweeklyFirstDay, biweeklySecondDay);
    dates.push(nextPayment);

    // Move past this payment date for next iteration
    currentDate = addDays(nextPayment, 1);
  }

  return dates;
}

/**
 * Format payment frequency for display
 */
export function formatPaymentFrequency(frequency: PaymentFrequency): string {
  switch (frequency) {
    case 'weekly':
      return 'Weekly';
    case 'biweekly':
      return 'Bi-weekly';
    case 'monthly':
      return 'Monthly';
    default:
      return frequency;
  }
}

/**
 * Get day name from day number (0-6)
 */
export function getDayName(day: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[day] || '';
}

/**
 * Format payment schedule for display
 */
export function formatPaymentSchedule(
  frequency: PaymentFrequency,
  paymentDay: number | null,
  biweeklyFirstDay?: number | null,
  biweeklySecondDay?: number | null
): string {
  switch (frequency) {
    case 'weekly':
      return `Every ${getDayName(paymentDay ?? 5)}`;
    case 'biweekly':
      const first = biweeklyFirstDay ?? 1;
      const second = biweeklySecondDay ?? 16;
      return `${getOrdinal(first)} and ${getOrdinal(second)} of each month`;
    case 'monthly':
      return `${getOrdinal(paymentDay ?? 1)} of each month`;
    default:
      return '';
  }
}

/**
 * Get ordinal suffix for a number
 */
function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
