/**
 * Payment Date Calculator
 * Handles payment scheduling with US holidays and weekend detection
 */

import { addDays, getDay, getMonth, getDate, getYear, setDate, addMonths, isWeekend, format, startOfDay, isBefore } from 'date-fns';

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
 * Calculate the next payment date based on frequency
 */
export function calculateNextPaymentDate(
  frequency: PaymentFrequency,
  paymentDay: number | null,
  fromDate: Date = new Date(),
  biweeklyFirstDay?: number | null,
  biweeklySecondDay?: number | null
): Date {
  const today = startOfDay(fromDate);
  let paymentDate: Date;

  switch (frequency) {
    case 'weekly':
      // Default to Friday (day 5) if no day specified
      const targetDay = paymentDay ?? 5;
      const currentDay = getDay(today);

      if (currentDay === targetDay) {
        // If today is the payment day, check if it's a business day
        paymentDate = today;
      } else if (currentDay < targetDay) {
        // Payment day is later this week
        paymentDate = addDays(today, targetDay - currentDay);
      } else {
        // Payment day is next week
        paymentDate = addDays(today, 7 - (currentDay - targetDay));
      }
      break;

    case 'biweekly':
      // Custom biweekly days or default to 1st and 16th
      const firstDay = biweeklyFirstDay ?? 1;
      const secondDay = biweeklySecondDay ?? 16;
      const currentDate = getDate(today);
      const currentMonth = getMonth(today);
      const currentYear = getYear(today);

      // <= so when today IS the payment day, it returns today instead of
      // skipping to the next slot. Old code used '<' which made an account
      // configured for day 16 with today=16 jump to next month's day 1.
      if (currentDate <= firstDay) {
        paymentDate = new Date(currentYear, currentMonth, firstDay);
      } else if (currentDate <= secondDay) {
        paymentDate = new Date(currentYear, currentMonth, secondDay);
      } else {
        // Past both days this month — next month's first day
        paymentDate = new Date(currentYear, currentMonth + 1, firstDay);
      }
      break;

    case 'monthly':
      // Payment on specific day of month (default to 1st)
      const monthlyDay = paymentDay ?? 1;
      const monthDate = getDate(today);

      if (monthDate <= monthlyDay) {
        // This month
        paymentDate = setDate(today, monthlyDay);
      } else {
        // Next month
        paymentDate = setDate(addMonths(today, 1), monthlyDay);
      }
      break;

    default:
      paymentDate = today;
  }

  // Ensure it's not in the past
  if (isBefore(paymentDate, today)) {
    if (frequency === 'weekly') {
      paymentDate = addDays(paymentDate, 7);
    } else if (frequency === 'biweekly') {
      const firstDay = biweeklyFirstDay ?? 1;
      const secondDay = biweeklySecondDay ?? 16;
      if (getDate(paymentDate) === firstDay) {
        paymentDate = setDate(paymentDate, secondDay);
      } else {
        paymentDate = new Date(getYear(paymentDate), getMonth(paymentDate) + 1, firstDay);
      }
    } else {
      paymentDate = addMonths(paymentDate, 1);
    }
  }

  // Move to next business day if falls on weekend or holiday
  return getNextBusinessDay(paymentDate);
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
