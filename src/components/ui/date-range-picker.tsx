'use client';

import * as React from 'react';
import {
  addDays,
  addMonths,
  addYears,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
  subMonths,
  subYears,
} from 'date-fns';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Parse a "YYYY-MM-DD" string into a local Date (avoids UTC shifting).
function parseYMD(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Format a Date back into "YYYY-MM-DD".
function toYMD(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

interface DateRangePickerProps {
  /** From date as "YYYY-MM-DD" (or empty string). */
  from: string;
  /** To date as "YYYY-MM-DD" (or empty string). */
  to: string;
  /** Called whenever the range changes. */
  onChange: (from: string, to: string) => void;
  className?: string;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function DateRangePicker({ from, to, onChange, className }: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const fromDate = parseYMD(from);
  const toDate = parseYMD(to);

  // The left-hand month shown in the dual-month calendar.
  const [viewMonth, setViewMonth] = React.useState<Date>(
    () => startOfMonth(fromDate ?? new Date()),
  );
  const [hovered, setHovered] = React.useState<Date | null>(null);

  // When opening, jump the view to wherever the current selection is.
  React.useEffect(() => {
    if (open) setViewMonth(startOfMonth(fromDate ?? new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleDayClick(day: Date) {
    // No anchor yet, or a full range already exists -> start a new range.
    if (!fromDate || (fromDate && toDate)) {
      onChange(toYMD(day), '');
      return;
    }
    // Anchor exists, pick the second end and order them.
    if (isBefore(day, fromDate)) {
      onChange(toYMD(day), toYMD(fromDate));
    } else {
      onChange(toYMD(fromDate), toYMD(day));
    }
  }

  function reset() {
    onChange('', '');
    setHovered(null);
  }

  // Effective range end for highlighting while hovering before the 2nd pick.
  const previewEnd = fromDate && !toDate && hovered ? hovered : toDate;
  const rangeStart =
    fromDate && previewEnd
      ? isBefore(previewEnd, fromDate)
        ? previewEnd
        : fromDate
      : fromDate;
  const rangeEnd =
    fromDate && previewEnd
      ? isBefore(previewEnd, fromDate)
        ? fromDate
        : previewEnd
      : null;

  function renderMonth(monthDate: Date) {
    const gridStart = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 0 });
    const days: Date[] = [];
    let cur = gridStart;
    while (!isAfter(cur, gridEnd)) {
      days.push(cur);
      cur = addDays(cur, 1);
    }
    const today = new Date();

    return (
      <div className="px-2">
        <div className="text-center text-sm font-semibold py-2">
          {format(monthDate, 'MMM yyyy')}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-center text-xs text-muted-foreground font-medium py-1">
              {w}
            </div>
          ))}
          {days.map((day) => {
            const outside = !isSameMonth(day, monthDate);
            const isStart = rangeStart && isSameDay(day, rangeStart);
            const isEnd = rangeEnd && isSameDay(day, rangeEnd);
            const inRange =
              rangeStart &&
              rangeEnd &&
              isWithinInterval(day, { start: rangeStart, end: rangeEnd });
            const isSingle = fromDate && !rangeEnd && isSameDay(day, fromDate);
            const isEndpoint = isStart || isEnd || isSingle;
            const isToday = isSameDay(day, today);

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => handleDayClick(day)}
                onMouseEnter={() => setHovered(day)}
                className={cn(
                  'h-8 w-9 mx-auto flex items-center justify-center text-sm transition-colors',
                  outside ? 'text-muted-foreground/40' : 'text-foreground',
                  // range fill (rounded only on the ends)
                  inRange && !isEndpoint && 'bg-blue-50 dark:bg-blue-950/40',
                  isStart && rangeEnd && 'rounded-l-md',
                  isEnd && rangeStart && 'rounded-r-md',
                  // endpoints
                  isEndpoint
                    ? 'bg-blue-500 text-white rounded-md font-medium hover:bg-blue-600'
                    : 'rounded-md hover:bg-accent',
                  // today marker (only when not an endpoint)
                  !isEndpoint && isToday && 'ring-1 ring-blue-400 ring-inset',
                )}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const triggerLabel =
    fromDate && toDate
      ? `${format(fromDate, 'MM/dd/yyyy')}  →  ${format(toDate, 'MM/dd/yyyy')}`
      : fromDate
        ? `${format(fromDate, 'MM/dd/yyyy')}  →  …`
        : 'Select date range';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 rounded-md border border-input bg-background px-3 h-9 text-sm shadow-sm hover:bg-accent/50 transition-colors',
            !fromDate && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <span className="tabular-nums">{triggerLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto p-0"
        onMouseLeave={() => setHovered(null)}
      >
        {/* Header: inputs + reset */}
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-2 text-sm tabular-nums">
            <span className={cn(!fromDate && 'text-muted-foreground')}>
              {fromDate ? format(fromDate, 'MM/dd/yyyy') : 'Start'}
            </span>
            <span className="text-muted-foreground">→</span>
            <span className={cn(!toDate && 'text-muted-foreground')}>
              {toDate ? format(toDate, 'MM/dd/yyyy') : 'End'}
            </span>
          </div>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
          >
            <X className="h-3 w-3" />
            Reset
          </button>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between px-3 pt-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewMonth((m) => subYears(m, 1))}
              className="p-1 rounded hover:bg-accent text-muted-foreground"
              aria-label="Previous year"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              className="p-1 rounded hover:bg-accent text-muted-foreground"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="p-1 rounded hover:bg-accent text-muted-foreground"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addYears(m, 1))}
              className="p-1 rounded hover:bg-accent text-muted-foreground"
              aria-label="Next year"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Dual month grid */}
        <div className="flex divide-x pb-3 pt-1">
          {renderMonth(viewMonth)}
          {renderMonth(addMonths(viewMonth, 1))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
