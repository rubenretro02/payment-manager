'use client';

import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { reportCycleGap, type PaymentFrequency } from '@/lib/payment-dates';

interface Props {
  forCycleDate: string | null | undefined;
  reportedAt: string | null | undefined;
  frequency?: PaymentFrequency | null;
  /** 'inline' = short label for list rows; 'block' = date + gap line for detail views */
  variant?: 'inline' | 'block';
}

function gapText(daysAfter: number): string {
  if (daysAfter === 0) return 'reported the same day';
  const n = Math.abs(daysAfter);
  const days = `${n} day${n === 1 ? '' : 's'}`;
  return daysAfter > 0 ? `reported ${days} after` : `reported ${days} BEFORE`;
}

/**
 * The cycle a payment was reported for, plus how far from that date it was
 * reported — so the admin can compare it with the date on the company
 * payment screenshot. Early or very late reports are highlighted.
 */
export function CycleInfo({ forCycleDate, reportedAt, frequency, variant = 'block' }: Props) {
  const gap = reportCycleGap(forCycleDate, reportedAt, frequency);
  if (!gap) return <span className="text-muted-foreground">not tagged</span>;

  const warn = gap.flag !== null;
  const hint =
    gap.flag === 'early'
      ? 'Reported before the cycle date — the company could not have paid yet. Check the date on the company screenshot.'
      : gap.flag === 'late'
        ? 'Reported long after the cycle — check the company screenshot is from this cycle and not an older one.'
        : 'Compare with the date on the company payment screenshot.';

  if (variant === 'inline') {
    return (
      <span className={`inline-flex items-center gap-1 ${warn ? 'text-amber-700 font-medium' : ''}`} title={hint}>
        {warn && <AlertTriangle className="h-3.5 w-3.5" />}
        cycle {format(gap.cycle, 'MMM d')}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end text-right" title={hint}>
      <span className="font-medium">{format(gap.cycle, 'EEE, MMM d, yyyy')}</span>
      {gap.daysAfter !== null && (
        <span className={`text-xs inline-flex items-center gap-1 ${warn ? 'text-amber-700 font-medium' : 'text-muted-foreground'}`}>
          {warn && <AlertTriangle className="h-3 w-3" />}
          {gapText(gap.daysAfter)}
        </span>
      )}
    </span>
  );
}
