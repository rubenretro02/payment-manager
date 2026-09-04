'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  Loader2,
  Briefcase,
  Clock,
  AlertTriangle,
  XCircle,
  Calendar,
  CreditCard,
  DollarSign,
  Upload,
  CheckCircle2,
  FolderOpen,
  Building2,
  Copy,
  Check,
  Wallet,
  Building,
  Star,
  Camera,
  Image as ImageIcon,
  X,
  RefreshCw,
  Eye,
  Plus,
  Send,
  History,
  Search,
} from 'lucide-react';
import { format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import type { Account, Payment, PaymentFrequency } from '@/lib/types';
import {
  formatPaymentFrequency,
  formatPaymentSchedule,
  calculateNextPaymentDate,
  calculatePreviousPaymentDate,
  getUpcomingPaymentDates,
  getCycleWindow,
} from '@/lib/payment-dates';
import { isCommissionAccount } from '@/lib/account-utils';
import { ScreenshotImage } from '@/components/ScreenshotImage';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { getCached, setCached, CACHE_KEYS, userCacheKey } from '@/lib/client-cache';
import { acceptedNetworks, acceptedTokenSymbols } from '@/lib/wallets/networks';

const statusColors: Record<string, string> = {
  production: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  nesting: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  active: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  drop: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  not_in_project: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

const statusLabels: Record<string, string> = {
  production: 'Production',
  nesting: 'Nesting',
  active: 'Active',
  drop: 'Drop',
  not_in_project: 'No Project',
};

const statusIcons: Record<string, typeof Briefcase> = {
  production: Briefcase,
  nesting: Clock,
  active: Briefcase,
  drop: AlertTriangle,
  not_in_project: XCircle,
};

// Default icon for payment methods - can be customized based on type name
const getTypeIcon = (type: string) => {
  const lowerType = type.toLowerCase();
  if (lowerType.includes('zelle')) return Wallet;
  if (lowerType.includes('binance') || lowerType.includes('crypto')) return CreditCard;
  if (lowerType.includes('bank') || lowerType.includes('transfer')) return Building;
  return CreditCard;
};

interface AdminPaymentMethod {
  id: string;
  type: string;
  display_name: string;
  details: string;
  instructions: string | null;
  is_active: boolean;
  is_primary: boolean;
}

interface UploadedImage {
  preview: string;
  telegramUrl: string | null;
  fileId: string | null;
  uploading: boolean;
  error: string | null;
}

export default function MyAccountsPage() {
  const { user } = useAuth();
  // Seed from the in-memory cache so coming back to this tab renders the
  // last-known data instantly while it refetches in the background.
  const cachedAccounts = user?.id ? getCached<Account[]>(userCacheKey('my-accounts', user.id)) : undefined;
  const cachedPayments = user?.id ? getCached<Payment[]>(userCacheKey('my-payments', user.id)) : undefined;
  const [accounts, setAccounts] = useState<Account[]>(() => cachedAccounts || []);
  const [payments, setPayments] = useState<Payment[]>(() => cachedPayments || []);
  const [adminPaymentMethods, setAdminPaymentMethods] = useState<AdminPaymentMethod[]>(
    () => getCached<AdminPaymentMethod[]>(CACHE_KEYS.paymentMethods) || []
  );
  const [loading, setLoading] = useState(cachedAccounts === undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedReportPayment, setSelectedReportPayment] = useState<Payment | null>(null);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [isNoPaymentDialogOpen, setIsNoPaymentDialogOpen] = useState(false);
  const [isViewReportDialogOpen, setIsViewReportDialogOpen] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [historyAccount, setHistoryAccount] = useState<Account | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Which cycle a report is being filed for (yyyy-MM-dd), so the user can
  // clear a specific overdue cycle. null = let the server auto-tag the nearest.
  const [selectedCycleStr, setSelectedCycleStr] = useState<string | null>(null);

  // Refs for file inputs
  const companyProofInputRef = useRef<HTMLInputElement>(null);
  const paymentProofInputRef = useRef<HTMLInputElement>(null);
  const companyCameraInputRef = useRef<HTMLInputElement>(null);
  const paymentCameraInputRef = useRef<HTMLInputElement>(null);

  // Payment form state
  const [paymentForm, setPaymentForm] = useState({
    platform_amount: '',
    amount_sent: '',
    payment_method: '',
    payment_reference: '',
    notes: '',
  });


  // No Payment / Issue form state
  const [noPaymentForm, setNoPaymentForm] = useState({
    reason: '',
  });

  // Two separate image states
  const [companyProofImage, setCompanyProofImage] = useState<UploadedImage | null>(null);
  const [paymentProofImage, setPaymentProofImage] = useState<UploadedImage | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  async function fetchData(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    try {
      const [accountsRes, methodsRes, paymentsRes] = await Promise.all([
        fetch(`/api/my-accounts?user_id=${user?.id}`),
        fetch('/api/payment-methods'),
        fetch(`/api/my-payments?user_id=${user?.id}`),
      ]);

      const accountsData = await accountsRes.json();
      const methodsData = await methodsRes.json();
      const paymentsData = await paymentsRes.json();

      if (accountsData.success) {
        setAccounts(accountsData.data || []);
        if (user?.id) setCached(userCacheKey('my-accounts', user.id), accountsData.data || []);
      }
      if (paymentsData.success) {
        setPayments(paymentsData.data || []);
        if (user?.id) setCached(userCacheKey('my-payments', user.id), paymentsData.data || []);
      }
      if (methodsData.success) {
        const activeMethods = (methodsData.data || []).filter((m: AdminPaymentMethod) => m.is_active);
        setAdminPaymentMethods(activeMethods);
        setCached(CACHE_KEYS.paymentMethods, activeMethods);
        // Only pick a default when nothing is selected yet — this also runs on
        // background refreshes, which must not override the user's choice.
        const primary = activeMethods.find((m: AdminPaymentMethod) => m.is_primary);
        const defaultId = primary?.id || activeMethods[0]?.id || '';
        if (defaultId) {
          setPaymentForm(prev => (prev.payment_method ? prev : { ...prev, payment_method: defaultId }));
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Get the most recent payment for the cycle the user owes RIGHT NOW.
  // Returns null if there's no submitted/confirmed payment tagged for that
  // cycle (or only a rejected one — user should report again).
  //
  // Matches on for_cycle_date (set at submission) instead of a rolling
  // today-minus-N-days window. The old window credited a report filed for the
  // PREVIOUS cycle to the current one, so when a new cycle came due the card
  // wrongly showed "Reported / Add another" instead of "Report Payment".
  //
  // The "due cycle" = the latest scheduled cycle on or before today:
  //   - on a due date  → that cycle (today),
  //   - between cycles → the previous one (still in its grace/overdue window
  //     until the next due date arrives).
  // This keeps the report visible after a user pays a day or two LATE (their
  // report is tagged to the just-passed cycle), without letting last cycle's
  // report satisfy a brand-new due day. Legacy untagged payments fall back to
  // a tight window — same cutoffs the admin Due Payments route uses.
  //
  // Counts 'pending' too: a 'No Payment / Issue' report is stored as a pending
  // payment, so it must satisfy the cycle as well — otherwise the card stays
  // on "Report Payment / No Payment" and users file duplicate issue reports
  // thinking the first didn't go through.
  const getCurrentPeriodReport = (account: Account): Payment | null => {
    const frequency = account.payment_frequency || 'weekly';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextCycle = new Date(getNextPayment(account));
    nextCycle.setHours(0, 0, 0, 0);
    const isDueToday = nextCycle.getTime() === today.getTime();
    const dueCycle = isDueToday
      ? nextCycle
      : calculatePreviousPaymentDate(
          frequency,
          account.payment_day,
          today,
          account.biweekly_first_day,
          account.biweekly_second_day
        );
    const dueCycleStr = format(dueCycle, 'yyyy-MM-dd');

    const legacyStart = new Date(today);
    if (frequency === 'weekly') legacyStart.setDate(legacyStart.getDate() - 5);
    else if (frequency === 'biweekly') legacyStart.setDate(legacyStart.getDate() - 12);
    else legacyStart.setDate(legacyStart.getDate() - 20);

    return payments
      .filter(p =>
        p.account_id === account.id &&
        (p.status === 'submitted' || p.status === 'confirmed' || p.status === 'pending') &&
        (p.for_cycle_date
          ? p.for_cycle_date === dueCycleStr
          : new Date(p.created_at) >= legacyStart)
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null;
  };

  // All payment reports for an account (any status), newest first — feeds the
  // "View History" dialog so the user sees the same full record the admin does.
  const getAccountHistory = (account: Account): Payment[] =>
    payments
      .filter(p => p.account_id === account.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Does this account already have a submitted/confirmed/pending report for a
  // given scheduled cycle? Prefer the for_cycle_date tag; legacy untagged rows
  // fall back to the ±half-cycle window (same logic as the admin route).
  const cycleHasReport = (account: Account, cycleDate: Date, cycleStr: string): boolean => {
    const frequency = account.payment_frequency || 'weekly';
    const { start, end } = getCycleWindow(cycleDate, frequency);
    return payments.some(p =>
      p.account_id === account.id &&
      (p.status === 'submitted' || p.status === 'confirmed' || p.status === 'pending') &&
      (p.for_cycle_date
        ? p.for_cycle_date === cycleStr
        : (new Date(p.created_at) >= start && new Date(p.created_at) <= end))
    );
  };

  // Any report at all for a cycle — rejected included. A rejected report
  // doesn't satisfy the cycle, but it proves the cycle was owed, so the
  // payment-active floor must not hide it (the admin sent it back; the user
  // has to report again).
  const cycleHasAnyRecord = (account: Account, cycleDate: Date, cycleStr: string): boolean => {
    const frequency = account.payment_frequency || 'weekly';
    const { start, end } = getCycleWindow(cycleDate, frequency);
    return payments.some(p =>
      p.account_id === account.id &&
      (p.for_cycle_date
        ? p.for_cycle_date === cycleStr
        : (new Date(p.created_at) >= start && new Date(p.created_at) <= end))
    );
  };

  // Every cycle the user still OWES a report for: the current due cycle plus
  // any earlier unpaid ones, oldest first. Walks back frequency-aware (same as
  // the admin Due Payments board) so an account that skipped several cycles
  // gets one Report button per missed cycle. Bounded by the payment-active
  // floor and ~6 cycles of lookback.
  const getOwedCycles = (account: Account): { date: Date; str: string; daysOverdue: number }[] => {
    const frequency = account.payment_frequency || 'weekly';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextCycle = new Date(getNextPayment(account));
    nextCycle.setHours(0, 0, 0, 0);
    const isDueToday = nextCycle.getTime() === today.getTime();
    // dueCycle = latest scheduled cycle on or before today.
    const dueCycle = isDueToday
      ? nextCycle
      : calculatePreviousPaymentDate(frequency, account.payment_day, today, account.biweekly_first_day, account.biweekly_second_day);

    const floorIso = account.payment_active_since || account.created_at;
    const floor = floorIso ? new Date(floorIso) : null;
    if (floor) floor.setHours(0, 0, 0, 0);
    const cycleDays = frequency === 'weekly' ? 7 : frequency === 'biweekly' ? 14 : 31;
    const lookbackDays = Math.max(60, cycleDays * 6);
    const lookbackCutoff = new Date(today);
    lookbackCutoff.setDate(lookbackCutoff.getDate() - lookbackDays);

    const owed: { date: Date; str: string; daysOverdue: number }[] = [];
    let cursor = new Date(dueCycle);
    for (let i = 0; i < 12; i++) {
      const str = format(cursor, 'yyyy-MM-dd');
      if (floor && cursor.getTime() < floor.getTime() && !cycleHasAnyRecord(account, cursor, str)) break;
      if (cursor.getTime() < lookbackCutoff.getTime()) break;
      if (!cycleHasReport(account, cursor, str)) {
        const daysOverdue = Math.round((today.getTime() - cursor.getTime()) / (1000 * 60 * 60 * 24));
        owed.push({ date: new Date(cursor), str, daysOverdue });
      }
      const prev = calculatePreviousPaymentDate(frequency, account.payment_day, cursor, account.biweekly_first_day, account.biweekly_second_day);
      if (prev.getTime() >= cursor.getTime()) break;
      cursor = prev;
    }

    // An OPEN No Payment / Issue (a pending payment) means the user already
    // flagged a problem for that period. Stop nagging that cycle AND every
    // older one as overdue — the admin resolves the issue by talking to them;
    // reporting a real payment later stays optional. (yyyy-MM-dd strings sort
    // chronologically, so a string compare is enough and timezone-proof.)
    const issueCutoffStr = payments
      .filter(p => p.account_id === account.id && p.status === 'pending')
      .map(p => p.for_cycle_date || format(new Date(p.created_at), 'yyyy-MM-dd'))
      .reduce<string | null>((max, s) => (!max || s > max ? s : max), null);
    const filtered = issueCutoffStr
      ? owed.filter(c => c.str > issueCutoffStr)
      : owed;

    return filtered.reverse(); // oldest first
  };

  // Best payment tied to a given cycle (confirmed > submitted > pending, then
  // most recent). Used to label the schedule timeline.
  const getCyclePayment = (account: Account, cycleDate: Date, cycleStr: string): Payment | null => {
    const frequency = account.payment_frequency || 'weekly';
    const { start, end } = getCycleWindow(cycleDate, frequency);
    const rank = (s: string) => (s === 'confirmed' ? 0 : s === 'submitted' ? 1 : 2);
    return payments
      .filter(p =>
        p.account_id === account.id &&
        (p.status === 'submitted' || p.status === 'confirmed' || p.status === 'pending') &&
        (p.for_cycle_date
          ? p.for_cycle_date === cycleStr
          : (new Date(p.created_at) >= start && new Date(p.created_at) <= end))
      )
      .sort((a, b) => rank(a.status) - rank(b.status) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null;
  };

  // A timeline of cycles for the schedule dialog: a few past/current cycles
  // (mapped to their payment status) plus the upcoming ones, with the real
  // "Next" = the first UNPAID cycle on/after today (so a cycle already paid
  // today doesn't keep showing as Next).
  type CycleStatus = 'paid' | 'reported' | 'issue' | 'missed' | 'due' | 'upcoming';
  const getScheduleTimeline = (
    account: Account
  ): { date: Date; str: string; status: CycleStatus; isNext: boolean }[] => {
    const frequency = account.payment_frequency || 'weekly';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextCycle = new Date(getNextPayment(account));
    nextCycle.setHours(0, 0, 0, 0);
    const isDueToday = nextCycle.getTime() === today.getTime();
    const dueCycle = isDueToday
      ? nextCycle
      : calculatePreviousPaymentDate(frequency, account.payment_day, today, account.biweekly_first_day, account.biweekly_second_day);

    const floorIso = account.payment_active_since || account.created_at;
    const floor = floorIso ? new Date(floorIso) : null;
    if (floor) floor.setHours(0, 0, 0, 0);

    // Past + current cycles: walk back from dueCycle up to 4 (bounded by floor).
    const dates: Date[] = [];
    let cursor = new Date(dueCycle);
    for (let i = 0; i < 4; i++) {
      if (floor && cursor.getTime() < floor.getTime() && !cycleHasAnyRecord(account, cursor, format(cursor, 'yyyy-MM-dd'))) break;
      dates.unshift(new Date(cursor));
      const prev = calculatePreviousPaymentDate(frequency, account.payment_day, cursor, account.biweekly_first_day, account.biweekly_second_day);
      if (prev.getTime() >= cursor.getTime()) break;
      cursor = prev;
    }

    // Upcoming cycles strictly after dueCycle.
    const afterDue = new Date(dueCycle);
    afterDue.setDate(afterDue.getDate() + 1);
    const upcoming = getUpcomingPaymentDates(
      frequency,
      account.payment_day ?? 5,
      5,
      afterDue,
      account.biweekly_first_day,
      account.biweekly_second_day
    );
    for (const d of upcoming) dates.push(d);

    let nextMarked = false;
    return dates.map((raw) => {
      const date = new Date(raw);
      date.setHours(0, 0, 0, 0);
      const str = format(date, 'yyyy-MM-dd');
      const payment = getCyclePayment(account, date, str);
      const isPast = date.getTime() < today.getTime();
      const isToday = date.getTime() === today.getTime();

      let status: CycleStatus;
      if (payment?.status === 'confirmed') status = 'paid';
      else if (payment?.status === 'submitted') status = 'reported';
      else if (payment?.status === 'pending') status = 'issue';
      else if (isPast) status = 'missed';
      else if (isToday) status = 'due';
      else status = 'upcoming';

      // Next = first unpaid cycle on/after today.
      let isNext = false;
      if (!nextMarked && !isPast && (status === 'upcoming' || status === 'due')) {
        isNext = true;
        nextMarked = true;
      }
      return { date, str, status, isNext };
    });
  };

  useEffect(() => {
    if (user?.id) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Keep the cards fresh: refetch when the app comes back to the foreground
  // and poll while visible, so an admin confirmation shows up on its own.
  useAutoRefresh(() => fetchData(), { enabled: !!user?.id });

  // List rows omit the screenshot URLs (they can be inline base64 images);
  // load the full row when a report is opened in the View dialog.
  useEffect(() => {
    const p = selectedReportPayment;
    if (!p || !p.screenshots_deferred || !isViewReportDialogOpen) return;
    let cancelled = false;
    fetch(`/api/payments/${p.id}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.success) return;
        setSelectedReportPayment((cur) => (cur && cur.id === p.id ? { ...cur, ...json.data, screenshots_deferred: false } : cur));
      })
      .catch((e) => console.error('Error loading report details:', e));
    return () => {
      cancelled = true;
    };
  }, [selectedReportPayment?.id, selectedReportPayment?.screenshots_deferred, isViewReportDialogOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = () => {
    fetchData(true);
  };

  /**
   * Shrink a base64 image so the API request body stays well under
   * Vercel's 4 MB limit. Used as a fallback when the Telegram upload
   * failed (so we'd otherwise send the raw base64).
   */
  const compressBase64Image = (dataUrl: string, maxWidth = 1200, quality = 0.7): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas not supported'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Failed to load image for compression'));
      img.src = dataUrl;
    });

  // Decide which URL to send for a screenshot — prefer the Telegram URL,
  // fall back to a compressed version of the base64 preview.
  const getScreenshotUrl = async (img: UploadedImage): Promise<string> => {
    if (img.telegramUrl) return img.telegramUrl;
    if (!img.preview) return '';
    // Only compress big base64 payloads (>500 KB). Skip already-tiny ones.
    if (img.preview.startsWith('data:') && img.preview.length > 500_000) {
      try {
        return await compressBase64Image(img.preview);
      } catch (err) {
        console.warn('Image compression failed, using original base64:', err);
        return img.preview;
      }
    }
    return img.preview;
  };

  // Get next payment date for an account (always calculates with weekend adjustment)
  const getNextPayment = (account: Account) => {
    // Always use calculateNextPaymentDate to ensure weekend/holiday adjustments are applied
    return calculateNextPaymentDate(
      account.payment_frequency || 'weekly',
      account.payment_day ?? 5,
      new Date(),
      account.biweekly_first_day,
      account.biweekly_second_day
    );
  };

  /**
   * Detect a missed previous cycle for this account — mirrors the admin
   * Due Payments logic so the user sees the same overdue indicator the
   * admin sees, with the previous due date (not the next one).
   */
  const getOverdueInfo = (account: Account): { isOverdue: boolean; missedDate: Date | null; daysOverdue: number } => {
    // Only payment-requiring statuses can be overdue. Active/drop/etc.
    // aren't supposed to be paying right now, so don't flag them.
    if (account.status !== 'production' && account.status !== 'nesting' && !account.force_payment_request) {
      return { isOverdue: false, missedDate: null, daysOverdue: 0 };
    }

    const frequency = account.payment_frequency || 'weekly';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextPaymentDate = getNextPayment(account);

    // No payment record check here — we're just showing the visual
    // indicator. If they already reported, the 'Reported' state elsewhere
    // on the card hides this. Same helper as admin Due Payments page.
    const previousPaymentDate = calculatePreviousPaymentDate(
      frequency,
      account.payment_day,
      today,
      account.biweekly_first_day,
      account.biweekly_second_day
    );

    // Floor: don't count cycles that happened before the account was
    // payment-active. Uses payment_active_since (set when status transitions
    // to production/nesting). Falls back to created_at for old rows that
    // existed before that column was added.
    const floorIso = account.payment_active_since || account.created_at;
    if (floorIso) {
      const floor = new Date(floorIso);
      floor.setHours(0, 0, 0, 0);
      // …unless that cycle was already reported (even if rejected): then it
      // was owed regardless of when the account became payment-active.
      if (previousPaymentDate < floor && !cycleHasAnyRecord(account, previousPaymentDate, format(previousPaymentDate, 'yyyy-MM-dd'))) {
        return { isOverdue: false, missedDate: null, daysOverdue: 0 };
      }
    }

    const daysSincePrevious = Math.round(
      (today.getTime() - previousPaymentDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const daysUntilNext = Math.round(
      (nextPaymentDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
    // Overdue window scales with frequency. Today === payment day still means
    // 'on time', not overdue.
    const overdueWindow = frequency === 'weekly' ? 7 : frequency === 'biweekly' ? 14 : 30;
    const isOverdue = daysSincePrevious > 0 && daysSincePrevious <= overdueWindow && daysUntilNext !== 0;
    return {
      isOverdue,
      missedDate: isOverdue ? previousPaymentDate : null,
      daysOverdue: isOverdue ? daysSincePrevious : 0,
    };
  };

  const calculateAmountOwed = (platformAmount: number, percentage: number) => {
    return (platformAmount * percentage) / 100;
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const getSelectedPaymentMethod = () => {
    return adminPaymentMethods.find(m => m.id === paymentForm.payment_method);
  };

  // Upload image - reads file and optionally uploads to Telegram
  const uploadToTelegram = async (
    file: File,
    caption: string,
    setImage: React.Dispatch<React.SetStateAction<UploadedImage | null>>
  ) => {
    // First, read the file as base64 (works for both camera and gallery)
    const readFileAsBase64 = (): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
    };

    try {
      // Read file first
      const base64Data = await readFileAsBase64();

      // Set preview immediately with base64
      setImage({
        preview: base64Data,
        telegramUrl: null,
        fileId: null,
        uploading: true,
        error: null,
      });

      // Try to upload to Telegram (optional - will use base64 if fails)
      try {
        // For camera captures, we may need to convert the file properly
        // Create a new blob with proper MIME type
        const arrayBuffer = await file.arrayBuffer();
        const mimeType = file.type || 'image/jpeg';
        const fileName = file.name || `photo_${Date.now()}.jpg`;
        const blob = new Blob([arrayBuffer], { type: mimeType });
        const properFile = new File([blob], fileName, { type: mimeType });

        const formData = new FormData();
        formData.append('file', properFile);
        formData.append('caption', caption);

        console.log('Uploading to Telegram:', {
          fileName: properFile.name,
          mimeType: properFile.type,
          size: properFile.size
        });

        const response = await fetch('/api/upload-to-telegram', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        console.log('Telegram upload response:', data);

        if (data.success && data.data?.url) {
          setImage(prev => prev ? {
            ...prev,
            telegramUrl: data.data.url,
            fileId: data.data.file_id,
            uploading: false,
            error: null,
          } : null);
        } else {
          // Telegram upload failed, but we have base64 - that's OK
          console.warn('Telegram upload failed, using base64:', data.error || 'Unknown error');
          setImage(prev => prev ? {
            ...prev,
            uploading: false,
            error: null, // Don't show error - base64 works fine
          } : null);
        }
      } catch (uploadError) {
        // Telegram upload failed, but we have base64 - that's OK
        console.warn('Telegram upload exception, using base64:', uploadError);
        setImage(prev => prev ? {
          ...prev,
          uploading: false,
          error: null, // Don't show error - base64 works fine
        } : null);
      }
    } catch (error) {
      console.error('Error reading file:', error);
      setImage({
        preview: '',
        telegramUrl: null,
        fileId: null,
        uploading: false,
        error: 'Could not read image. Please try again.',
      });
    }
  };

  const handleImageSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'company' | 'payment'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const caption = type === 'company'
      ? `Company Payment - ${selectedAccount?.full_name} - ${user?.telegram_first_name}`
      : `Payment Sent - ${selectedAccount?.full_name} - ${user?.telegram_first_name}`;

    if (type === 'company') {
      uploadToTelegram(file, caption, setCompanyProofImage);
    } else {
      uploadToTelegram(file, caption, setPaymentProofImage);
    }

    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const removeImage = (type: 'company' | 'payment') => {
    if (type === 'company') {
      setCompanyProofImage(null);
    } else {
      setPaymentProofImage(null);
    }
  };

  const handleSubmitPayment = async () => {
    if (!selectedAccount || !paymentForm.platform_amount || !paymentForm.amount_sent) {
      alert('Please fill all required fields');
      return;
    }

    // Company screenshot is always required (verifies what the platform paid)
    if (!companyProofImage) {
      alert('Please upload the Company Payment screenshot');
      return;
    }

    // If the amount sent doesn't match what's owed, require an explanation
    const platformAmt = parseFloat(paymentForm.platform_amount);
    const expectedOwed = calculateAmountOwed(platformAmt, selectedAccount.percentage);
    const sentAmt = parseFloat(paymentForm.amount_sent);
    // 1-cent tolerance for floating-point precision
    const hasMismatch = Math.abs(sentAmt - expectedOwed) >= 0.01;
    if (hasMismatch && !paymentForm.notes.trim()) {
      alert('You sent a different amount than owed. Please explain the reason in the Notes field.');
      return;
    }

    const refValue = (paymentForm.payment_reference || '').trim();

    // Both screenshots are mandatory now: company-payment proof AND
    // payment-sent proof — even for crypto/auto-verify reports.
    if (!paymentProofImage) {
      alert('Please upload the Payment Sent screenshot');
      return;
    }

    // Check if images are still uploading
    if (companyProofImage.uploading || paymentProofImage?.uploading) {
      alert('Please wait for images to finish uploading');
      return;
    }

    setIsSubmitting(true);

    const platformAmount = parseFloat(paymentForm.platform_amount);
    const amountSent = parseFloat(paymentForm.amount_sent);
    const amountToSend = calculateAmountOwed(platformAmount, selectedAccount.percentage);
    const selectedMethod = getSelectedPaymentMethod();

    try {
      // Prepare screenshot URLs — compress base64 fallbacks so the payload
      // stays under Vercel's 4 MB body limit (root cause of the intermittent
      // 'Error submitting' Rickens was hitting on flaky connections).
      const companyUrl = await getScreenshotUrl(companyProofImage);
      const paymentUrl = paymentProofImage ? await getScreenshotUrl(paymentProofImage) : null;

      const paymentData: Record<string, unknown> = {
        user_id: user?.id,
        account_id: selectedAccount.id,
        platform_amount: platformAmount,
        percentage_applied: selectedAccount.percentage,
        amount_owed: amountToSend,
        amount_paid: amountSent,
        payment_method: selectedMethod?.type || 'other',
        payment_reference: refValue || null,
        user_notes: paymentForm.notes || null,
        company_screenshot_url: companyUrl,
      };

      // Tag the report to the specific cycle the user chose to report (so it
      // clears that exact overdue row). null → server auto-tags the nearest.
      if (selectedCycleStr) {
        paymentData.for_cycle_date = selectedCycleStr;
      }

      // file_id is the permanent Telegram handle — without it we can't
      // regenerate a working URL after the original one expires.
      if (companyProofImage.fileId) {
        paymentData.company_screenshot_file_id = companyProofImage.fileId;
      }

      if (paymentUrl) {
        paymentData.payment_screenshot_url = paymentUrl;
      }
      if (paymentProofImage?.fileId) {
        paymentData.payment_screenshot_file_id = paymentProofImage.fileId;
      }

      console.log('Submitting payment:', paymentData);

      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentData),
      });

      const data = await response.json();
      console.log('Payment response:', data);

      if (data.success) {
        // Show the new report on the card immediately (no waiting for the
        // refetch), then refresh in the background.
        const created = data.data as Payment | undefined;
        if (created?.id) {
          setPayments(prev => (prev.some(p => p.id === created.id) ? prev : [created, ...prev]));
        }
        setIsPaymentDialogOpen(false);
        resetForm();
        alert(
          data.duplicate
            ? 'This payment was already reported a moment ago. No duplicate was created.'
            : 'Payment submitted successfully! Admin will review it. You will receive a notification when it is confirmed.'
        );
        fetchData();
      } else {
        // Show the server's error so the user (and admin) knows what failed
        const msg = data.error || data.message || 'Failed to submit payment';
        console.error('Payment error:', data);
        alert(`Error submitting payment:\n\n${msg}\n\nPlease screenshot this message and send it to admin if it keeps happening.`);
      }
    } catch (error) {
      // Surface the network/runtime error instead of a generic 'try again'
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error submitting payment:', error);
      alert(`Could not submit payment.\n\nDetails: ${msg}\n\nThis usually means a slow connection or the screenshot was too large. Try again, or take a smaller screenshot.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    const primary = adminPaymentMethods.find(m => m.is_primary);
    setPaymentForm({
      platform_amount: '',
      amount_sent: '',
      payment_method: primary?.id || adminPaymentMethods[0]?.id || '',
      payment_reference: '',
      notes: '',
    });
    setCompanyProofImage(null);
    setPaymentProofImage(null);
    setSelectedCycleStr(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const selectedPaymentMethod = getSelectedPaymentMethod();

  // Image upload component
  const ImageUploadBox = ({
    type,
    label,
    image,
    inputRef,
    cameraRef
  }: {
    type: 'company' | 'payment';
    label: string;
    image: UploadedImage | null;
    inputRef: React.RefObject<HTMLInputElement | null>;
    cameraRef: React.RefObject<HTMLInputElement | null>;
  }) => (
    <div className="grid gap-2">
      <Label className="flex flex-wrap items-center gap-1.5">
        <span>{label}</span>
        <span className="text-red-600 font-bold">*</span>
        {!image && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-950/50 border border-red-300 dark:border-red-800 rounded px-1.5 py-0.5">
            Required
          </span>
        )}
      </Label>
      <div className={`border-2 border-dashed rounded-lg p-4 ${image ? 'border-green-400 bg-green-50/40 dark:bg-green-950/20' : 'border-red-400 bg-red-50/50 dark:bg-red-950/20'}`}>
        {image ? (
          <div className="space-y-2">
            <div className="relative">
              <img
                src={image.preview}
                alt={label}
                className="max-h-32 mx-auto rounded-lg"
              />
              {image.uploading && (
                <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                  <div className="text-center text-white">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    <p className="text-xs mt-1">Uploading...</p>
                  </div>
                </div>
              )}
              {image.telegramUrl && (
                <div className="absolute top-1 right-1 bg-green-500 rounded-full p-1">
                  <Check className="h-3 w-3 text-white" />
                </div>
              )}
            </div>
            {image.error && (
              <p className="text-xs text-yellow-600 text-center">{image.error}</p>
            )}
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => removeImage(type)}
                disabled={image.uploading}
              >
                <X className="h-3 w-3 mr-1" />
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-center gap-3">
              {/* Upload file button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                Upload
              </Button>
              {/* Camera button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => cameraRef.current?.click()}
                className="gap-2"
              >
                <Camera className="h-4 w-4" />
                Camera
              </Button>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              Take a photo or upload an image
            </p>
          </div>
        )}
      </div>
      {/* Hidden file inputs */}
      <input
        ref={inputRef as React.LegacyRef<HTMLInputElement>}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleImageSelect(e, type)}
      />
      {/* Camera input with capture attribute */}
      <input
        ref={cameraRef as React.LegacyRef<HTMLInputElement>}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleImageSelect(e, type)}
      />
    </div>
  );

  return (
    <div className="space-y-6 animate-in">
      {/* Header with Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">My Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Your work accounts and payments
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-yellow-600 dark:text-yellow-400" />
        <Input
          placeholder="Search by name, email, platform, project..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 bg-yellow-50 border-yellow-300 focus-visible:ring-yellow-400 placeholder:text-yellow-700/60 dark:bg-yellow-950/30 dark:border-yellow-700 dark:placeholder:text-yellow-400/60"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-yellow-700 hover:text-yellow-900 dark:text-yellow-400"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Stats - Clickable Cards */}
      <div className="grid gap-4 grid-cols-3">
        <Card
          className={`cursor-pointer transition-all hover:border-primary/50 active:scale-[0.98] ${
            statusFilter === null ? 'ring-2 ring-primary border-primary' : ''
          }`}
          onClick={() => setStatusFilter(null)}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{accounts.length}</p>
              </div>
              <Building2 className="h-8 w-8 text-muted-foreground/20" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:border-green-500/50 active:scale-[0.98] ${
            statusFilter === 'production' ? 'ring-2 ring-green-500 border-green-500' : ''
          }`}
          onClick={() => setStatusFilter(statusFilter === 'production' ? null : 'production')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Production</p>
                <p className="text-2xl font-bold text-green-600">
                  {accounts.filter(a => a.status === 'production').length}
                </p>
              </div>
              <Briefcase className="h-8 w-8 text-green-600/20" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:border-yellow-500/50 active:scale-[0.98] ${
            statusFilter === 'nesting' ? 'ring-2 ring-yellow-500 border-yellow-500' : ''
          }`}
          onClick={() => setStatusFilter(statusFilter === 'nesting' ? null : 'nesting')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Nesting</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {accounts.filter(a => a.status === 'nesting').length}
                </p>
              </div>
              <Clock className="h-8 w-8 text-yellow-600/20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Filter Badge */}
      {statusFilter && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filtering by:</span>
          <Badge
            variant="outline"
            className={`cursor-pointer ${statusColors[statusFilter]}`}
            onClick={() => setStatusFilter(null)}
          >
            {statusLabels[statusFilter]}
            <X className="h-3 w-3 ml-1" />
          </Badge>
        </div>
      )}

      {/* Accounts List */}
      {(() => {
        const q = searchQuery.trim().toLowerCase();
        const searchedAccounts = q
          ? accounts.filter(a =>
              a.full_name?.toLowerCase().includes(q) ||
              a.account_email?.toLowerCase().includes(q) ||
              a.platform?.display_name?.toLowerCase().includes(q) ||
              a.project?.display_name?.toLowerCase().includes(q))
          : accounts;
        const filteredAccounts = statusFilter
          ? searchedAccounts.filter(a => a.status === statusFilter)
          : searchedAccounts;

        if (accounts.length === 0) {
          return (
            <Card>
              <CardContent className="p-8 text-center">
                <Briefcase className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="font-medium text-lg">No accounts assigned</h3>
                <p className="text-muted-foreground">
                  You don't have any work accounts assigned yet. Contact your admin.
                </p>
              </CardContent>
            </Card>
          );
        }

        if (filteredAccounts.length === 0 && q) {
          return (
            <Card>
              <CardContent className="p-8 text-center">
                <Search className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="font-medium text-lg">No matches</h3>
                <p className="text-muted-foreground">
                  No accounts match &ldquo;{searchQuery}&rdquo;
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setSearchQuery('')}
                >
                  Clear search
                </Button>
              </CardContent>
            </Card>
          );
        }

        if (filteredAccounts.length === 0 && statusFilter) {
          return (
            <Card>
              <CardContent className="p-8 text-center">
                <Briefcase className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="font-medium text-lg">No {statusLabels[statusFilter]} accounts</h3>
                <p className="text-muted-foreground">
                  You don't have any accounts with status "{statusLabels[statusFilter]}"
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setStatusFilter(null)}
                >
                  Show all accounts
                </Button>
              </CardContent>
            </Card>
          );
        }

        return (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredAccounts.map((account) => {
            const StatusIcon = statusIcons[account.status] || Briefcase;
            const isCommission = isCommissionAccount(account);
            // Commission accounts have no schedule — skip date/overdue work.
            const nextPayment = isCommission ? null : getNextPayment(account);
            const isPaymentDue = nextPayment ? nextPayment <= new Date() : false;
            const overdueInfo = isCommission
              ? { isOverdue: false, missedDate: null, daysOverdue: 0 }
              : getOverdueInfo(account);
            const currentReport = isCommission ? null : getCurrentPeriodReport(account);
            const showOverdueBanner = overdueInfo.isOverdue && !currentReport;

            return (
              <Card key={account.id} className={showOverdueBanner ? 'border-red-500 border-2' : isPaymentDue ? 'border-yellow-500' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          setHistoryAccount(account);
                          setIsHistoryDialogOpen(true);
                        }}
                        className="text-left group"
                      >
                        <CardTitle className="text-lg group-hover:text-primary group-hover:underline transition-colors">
                          {account.full_name}
                        </CardTitle>
                      </button>
                      <CardDescription>{account.account_email}</CardDescription>
                    </div>
                    <Badge className={statusColors[account.status] || statusColors.not_in_project}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {statusLabels[account.status] || account.status}
                    </Badge>
                  </div>
                  {showOverdueBanner && overdueInfo.missedDate && (
                    <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 p-2 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                      <div className="text-xs">
                        <p className="font-semibold text-red-700 dark:text-red-400">
                          Overdue {overdueInfo.daysOverdue} day{overdueInfo.daysOverdue !== 1 ? 's' : ''}
                        </p>
                        <p className="text-red-600 dark:text-red-400">
                          Was due {format(overdueInfo.missedDate, 'MMMM d', { locale: enUS })} — please report your payment
                        </p>
                      </div>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Platform & Project */}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {account.platform?.display_name || 'Platform'}
                    </Badge>
                    {account.project && (
                      <Badge className={isCommission
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400"}>
                        <FolderOpen className="h-3 w-3 mr-1" />
                        {account.project.display_name}
                      </Badge>
                    )}
                  </div>

                  {/* Payment Info */}
                  <div className="rounded-lg bg-muted p-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Your percentage:</span>
                      <span className="font-semibold text-primary">{account.percentage}%</span>
                    </div>
                    {isCommission ? null : (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Frequency:</span>
                          <span>{formatPaymentFrequency(account.payment_frequency || 'weekly')}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Next payment:</span>
                          <span className={isPaymentDue ? 'text-yellow-600 font-medium' : ''}>
                            {nextPayment ? format(nextPayment, "MMM d, yyyy", { locale: enUS }) : '—'}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* View History — full payment record for this account, with
                      drill-down into each report. Same data the admin sees. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-950/30"
                    onClick={() => {
                      setHistoryAccount(account);
                      setIsHistoryDialogOpen(true);
                    }}
                  >
                    <History className="h-4 w-4 mr-2" />
                    View History
                  </Button>

                  {/* Commission accounts: always reportable (any status except drop). */}
                  {isCommission && account.status !== 'drop' && (
                    <div className="space-y-2">
                      <Button
                        className="w-full"
                        onClick={() => {
                          setSelectedAccount(account);
                          setIsPaymentDialogOpen(true);
                        }}
                      >
                        <DollarSign className="h-4 w-4 mr-2" />
                        Report Commission Payment
                      </Button>
                    </div>
                  )}

                  {/* Actions - Only show Report Payment for production/nesting accounts */}
                  {!isCommission && (account.status === 'production' || account.status === 'nesting' || account.force_payment_request) && (() => {
                    // Owed cycles (current due + any earlier unpaid) → one Report
                    // button per cycle so the user can clear each overdue one,
                    // each report tagged to its exact cycle.
                    const owed = getOwedCycles(account);
                    if (owed.length > 0) {
                      return (
                        <div className="space-y-2">
                          {owed.length > 1 && (
                            <p className="text-xs font-semibold text-foreground">
                              {owed.length} payments to report
                            </p>
                          )}
                          {owed.map((c) => {
                            const overdue = c.daysOverdue > 0;
                            return (
                              <div
                                key={c.str}
                                className={`rounded-lg border p-2.5 space-y-2 ${
                                  overdue
                                    ? 'bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-800'
                                    : 'bg-yellow-50 border-yellow-300 dark:bg-yellow-950/30 dark:border-yellow-800'
                                }`}
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">
                                    {format(c.date, 'MMM d, yyyy', { locale: enUS })}
                                  </p>
                                  <p className={`text-xs ${overdue ? 'text-red-600 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'}`}>
                                    {overdue ? `${c.daysOverdue} day${c.daysOverdue !== 1 ? 's' : ''} overdue` : 'Due today'}
                                  </p>
                                </div>
                                {/* Two clearly-labelled buttons per cycle so nobody
                                    confuses them. No Payment is red, tags THIS cycle. */}
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="flex-1"
                                    onClick={() => {
                                      setSelectedAccount(account);
                                      setSelectedCycleStr(c.str);
                                      setIsPaymentDialogOpen(true);
                                    }}
                                  >
                                    <DollarSign className="h-4 w-4 mr-1.5" />
                                    Report Payment
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                                    onClick={() => {
                                      setSelectedAccount(account);
                                      setSelectedCycleStr(c.str);
                                      setNoPaymentForm({ reason: '' });
                                      setIsNoPaymentDialogOpen(true);
                                    }}
                                  >
                                    <AlertTriangle className="h-4 w-4 mr-1.5" />
                                    No Payment / Issue
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              setSelectedAccount(account);
                              setIsScheduleDialogOpen(true);
                            }}
                          >
                            <Calendar className="h-4 w-4 mr-2" />
                            View Schedule
                          </Button>
                        </div>
                      );
                    }

                    const currentReport = getCurrentPeriodReport(account);

                    // Already reported for this period — show status + view + add another.
                    // 'pending' = a 'No Payment / Issue' report; render it distinctly
                    // (amber, no amount) so it's clearly a reported issue, not a payment.
                    if (currentReport) {
                      const isConfirmed = currentReport.status === 'confirmed';
                      const isNoPayment = currentReport.status === 'pending';
                      return (
                        <div className="space-y-2">
                          <div className={`rounded-lg border p-3 flex items-center gap-2 ${
                            isConfirmed
                              ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'
                              : isNoPayment
                              ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800'
                              : 'bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800'
                          }`}>
                            {isConfirmed ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                            ) : isNoPayment ? (
                              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                            ) : (
                              <Send className="h-4 w-4 text-purple-600 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${
                                isConfirmed ? 'text-green-700 dark:text-green-400'
                                  : isNoPayment ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-purple-700 dark:text-purple-400'
                              }`}>
                                {isConfirmed ? 'Reported & Confirmed'
                                  : isNoPayment ? 'No Payment / Issue reported'
                                  : 'Reported – Awaiting Confirmation'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {isNoPayment
                                  ? `Awaiting admin review · ${format(new Date(currentReport.created_at), 'MMM d')}`
                                  : `$${Number(currentReport.amount_paid || 0).toFixed(2)} on ${format(new Date(currentReport.created_at), 'MMM d')}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => {
                                setSelectedReportPayment(currentReport);
                                setSelectedAccount(account);
                                setIsViewReportDialogOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              View
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => {
                                setSelectedAccount(account);
                                setIsPaymentDialogOpen(true);
                              }}
                            >
                              {isNoPayment ? (
                                <><DollarSign className="h-4 w-4 mr-2" />Report Payment</>
                              ) : (
                                <><Plus className="h-4 w-4 mr-2" />Add another</>
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedAccount(account);
                                setIsScheduleDialogOpen(true);
                              }}
                            >
                              <Calendar className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    }

                    // No report for current period — show normal Report Payment buttons
                    return (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Button
                            className="flex-1"
                            onClick={() => {
                              setSelectedAccount(account);
                              setIsPaymentDialogOpen(true);
                            }}
                          >
                            <DollarSign className="h-4 w-4 mr-2" />
                            Report Payment
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setSelectedAccount(account);
                              setIsScheduleDialogOpen(true);
                            }}
                          >
                            <Calendar className="h-4 w-4" />
                          </Button>
                        </div>
                        {/* No Payment / Issue Button */}
                        <Button
                          variant="outline"
                          className="w-full border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                          onClick={() => {
                            setSelectedAccount(account);
                            setNoPaymentForm({ reason: '' });
                            setIsNoPaymentDialogOpen(true);
                          }}
                        >
                          <AlertTriangle className="h-4 w-4 mr-2" />
                          No Payment / Issue
                        </Button>
                      </div>
                    );
                  })()}

                  {/* For non-production/nesting regular accounts, only show schedule. */}
                  {!isCommission && account.status !== 'production' && account.status !== 'nesting' && !account.force_payment_request && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setSelectedAccount(account);
                        setIsScheduleDialogOpen(true);
                      }}
                    >
                      <Calendar className="h-4 w-4 mr-2" />
                      View Schedule
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
          </div>
        );
      })()}

      {/* Payment Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={(open) => {
        setIsPaymentDialogOpen(open);
        if (!open) resetForm();
      }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">Report Payment</DialogTitle>
            <DialogDescription>
              Report a payment for <span className="font-semibold">{selectedAccount?.full_name}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Account Info */}
            <div className="rounded-lg bg-muted p-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Platform:</span>
                <span>{selectedAccount?.platform?.display_name}</span>
                <span className="text-muted-foreground">Your percentage:</span>
                <span className="font-semibold text-primary">{selectedAccount?.percentage}%</span>
              </div>
            </div>

            {/* STEP 1 — Company paid you */}
            <div className="rounded-xl border-2 border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 p-4 space-y-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold">1</span>
                  <Label htmlFor="platform_amount" className="text-base font-bold text-blue-900 dark:text-blue-200">
                    How much did the company pay you?
                  </Label>
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-300 ml-8">
                  Enter the FULL amount {selectedAccount?.platform?.display_name || 'the platform'} paid into your account.
                </p>
              </div>
              <Input
                id="platform_amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={paymentForm.platform_amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, platform_amount: e.target.value })}
                className="text-2xl font-bold h-14 bg-white dark:bg-background"
              />
            </div>

            {/* Screenshot 1: Company Payment Proof */}
            <ImageUploadBox
              type="company"
              label="📸 Screenshot of company payment"
              image={companyProofImage}
              inputRef={companyProofInputRef}
              cameraRef={companyCameraInputRef}
            />

            {/* STEP 2 — You owe (auto-calculated) */}
            {paymentForm.platform_amount && selectedAccount && (
              <div className="rounded-xl border-2 border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-600 text-white text-sm font-bold">2</span>
                  <span className="text-base font-bold text-orange-900 dark:text-orange-200">You must send to admin:</span>
                </div>
                <div className="text-center my-3">
                  <p className="text-4xl font-extrabold text-orange-600 dark:text-orange-400">
                    ${calculateAmountOwed(parseFloat(paymentForm.platform_amount), selectedAccount.percentage).toFixed(2)}
                  </p>
                  <p className="text-xs text-orange-700 dark:text-orange-400 mt-1">
                    ({selectedAccount.percentage}% of ${parseFloat(paymentForm.platform_amount).toFixed(2)})
                  </p>
                </div>
                {/* What the worker keeps — small line inside the same step so it's
                    clearly part of step 2, not a competing big number. */}
                <div className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2">
                  <span className="text-sm font-semibold text-green-800 dark:text-green-300">✓ You keep:</span>
                  <span className="text-base font-bold text-green-700 dark:text-green-400">
                    ${(parseFloat(paymentForm.platform_amount) - calculateAmountOwed(parseFloat(paymentForm.platform_amount), selectedAccount.percentage)).toFixed(2)}
                  </span>
                  <span className="text-xs text-green-700/80 dark:text-green-400/80">
                    ({100 - selectedAccount.percentage}%)
                  </span>
                </div>
              </div>
            )}

            {/* STEP 3 — Amount you actually sent to admin */}
            <div className="rounded-xl border-2 border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 p-4 space-y-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white text-sm font-bold">3</span>
                  <Label htmlFor="amount_sent" className="text-base font-bold text-green-900 dark:text-green-200">
                    Amount you sent to admin
                  </Label>
                </div>
                <p className="text-xs text-green-700 dark:text-green-300 ml-8">
                  The amount you actually transferred to the admin&apos;s account/wallet.
                </p>
              </div>
              <Input
                id="amount_sent"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={paymentForm.amount_sent}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount_sent: e.target.value })}
                className="text-2xl font-bold h-14 bg-white dark:bg-background"
              />
              {paymentForm.amount_sent && paymentForm.platform_amount && selectedAccount && (() => {
                const sentVal = parseFloat(paymentForm.amount_sent);
                const owedVal = calculateAmountOwed(parseFloat(paymentForm.platform_amount), selectedAccount.percentage);
                const diff = sentVal - owedVal;
                // 1-cent tolerance to ignore floating-point precision issues
                if (Math.abs(diff) < 0.01) {
                  return <p className="text-sm font-semibold text-center"><span className="text-green-700 dark:text-green-400">✓ Exact amount</span></p>;
                }
                if (diff < 0) {
                  return <p className="text-sm font-semibold text-center"><span className="text-red-600 dark:text-red-400">⚠ You sent ${Math.abs(diff).toFixed(2)} LESS</span></p>;
                }
                return <p className="text-sm font-semibold text-center"><span className="text-blue-600 dark:text-blue-400">+${diff.toFixed(2)} MORE than required</span></p>;
              })()}
            </div>

            {/* Payment Method Selection */}
            <div className="grid gap-2">
              <Label>Payment Method Used *</Label>
              {adminPaymentMethods.length > 0 ? (
                <Select
                  value={paymentForm.payment_method}
                  onValueChange={(value) => setPaymentForm({ ...paymentForm, payment_method: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select payment method" />
                  </SelectTrigger>
                  <SelectContent>
                    {adminPaymentMethods.map((method) => {
                      const Icon = getTypeIcon(method.type);
                      return (
                        <SelectItem key={method.id} value={method.id}>
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4" />
                            <span>{method.display_name || method.type}</span>
                            {method.is_primary && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-300">
                  No payment methods configured. Contact your admin.
                </div>
              )}
            </div>

            {/* Show Selected Payment Method Details — hidden for crypto methods
                when account has its own wallet (account-specific orange box covers it) */}
            {selectedPaymentMethod && (() => {
              const methodType = (selectedPaymentMethod.type || '').toLowerCase();
              const isCryptoMethod = methodType.includes('crypto') || methodType.includes('wallet') || methodType.includes('binance');
              const accountHasWallet = !!selectedAccount?.wallet_address;
              const hasDetails = !!(selectedPaymentMethod.details || '').trim();

              // Hide entirely if it's a crypto method, account has its own wallet, and global details are empty
              if (isCryptoMethod && accountHasWallet && !hasDetails) return null;

              return (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const Icon = getTypeIcon(selectedPaymentMethod.type);
                        return <Icon className="h-4 w-4 text-primary" />;
                      })()}
                      <span className="font-medium text-sm">{selectedPaymentMethod.display_name || selectedPaymentMethod.type}</span>
                      {selectedPaymentMethod.is_primary && (
                        <Badge className="bg-yellow-500 text-xs">Preferred</Badge>
                      )}
                    </div>
                  </div>
                  {hasDetails && (
                    <div className="flex items-center gap-2 bg-background/80 rounded-md p-2 mb-2">
                      <code className="text-sm font-mono flex-1 break-all">
                        {selectedPaymentMethod.details}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => copyToClipboard(selectedPaymentMethod.details, selectedPaymentMethod.id)}
                      >
                        {copiedId === selectedPaymentMethod.id ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  )}
                  {selectedPaymentMethod.instructions && (
                    <p className="text-xs text-muted-foreground">
                      {selectedPaymentMethod.instructions}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Account-specific Crypto Wallet — only shown when user picked a crypto method */}
            {selectedAccount?.wallet_address && (() => {
              const methodType = (selectedPaymentMethod?.type || '').toLowerCase();
              const isCryptoMethod =
                methodType.includes('crypto') ||
                methodType.includes('wallet') ||
                methodType.includes('binance') ||
                methodType.includes('usdc') ||
                methodType.includes('usdt');
              if (!isCryptoMethod) return null;
              return (
                <div className="rounded-xl border-2 border-purple-400 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/30 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Wallet className="h-5 w-5 text-purple-700 dark:text-purple-300" />
                    <span className="font-bold text-base text-purple-900 dark:text-purple-200">
                      Admin&apos;s wallet — SEND YOUR PAYMENT HERE
                    </span>
                    <Badge className="bg-purple-600 text-xs uppercase ml-auto">
                      {acceptedNetworks(selectedAccount.wallet_network)[0].family === 'solana' ? 'Solana' : 'EVM'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 bg-white dark:bg-background rounded-lg p-3 border border-purple-200">
                    <code className="text-sm font-mono flex-1 break-all">
                      {selectedAccount.wallet_address}
                    </code>
                    <Button
                      variant="default"
                      size="sm"
                      className="shrink-0 bg-purple-600 hover:bg-purple-700"
                      onClick={() => copyToClipboard(selectedAccount.wallet_address!, `wallet-${selectedAccount.id}`)}
                    >
                      {copiedId === `wallet-${selectedAccount.id}` ? (
                        <><Check className="h-4 w-4 mr-1" /> Copied!</>
                      ) : (
                        <><Copy className="h-4 w-4 mr-1" /> Copy</>
                      )}
                    </Button>
                  </div>
                  {/* An EVM address is the same on every EVM network, so list all
                      of them (preferred first) instead of restricting to one. */}
                  {(() => {
                    const nets = acceptedNetworks(selectedAccount.wallet_network);
                    const isSolana = nets[0].family === 'solana';
                    const tokens = acceptedTokenSymbols(selectedAccount.wallet_network);
                    return (
                      <div className="mt-3 space-y-2 text-xs">
                        <div>
                          <p className="font-semibold text-purple-900 dark:text-purple-200 mb-1">
                            {isSolana
                              ? 'Send on the Solana network only:'
                              : 'You can send on ANY of these networks — same address on all of them:'}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {nets.map((n, i) => (
                              <Badge
                                key={n.key}
                                variant="outline"
                                className={
                                  i === 0 && nets.length > 1
                                    ? 'border-purple-500 bg-purple-100 text-purple-900 font-semibold dark:bg-purple-900/40 dark:text-purple-100'
                                    : 'border-purple-200 text-purple-800 dark:border-purple-800 dark:text-purple-300'
                                }
                                title={`On exchanges: ${n.exchangeLabel}`}
                              >
                                {n.label}{i === 0 && nets.length > 1 ? ' · preferred' : ''}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <p className="text-purple-800 dark:text-purple-300">
                          <span className="font-semibold">Accepted tokens:</span> {tokens.join(', ')}
                        </p>
                        <p className="text-red-700 dark:text-red-400 font-semibold">
                          ⚠️ {isSolana
                            ? 'Do NOT send from Ethereum, Base, BNB, Tron, Bitcoin or any non-Solana network — funds would be lost.'
                            : 'Do NOT send from Solana, Tron, Bitcoin or any non-EVM network — funds would be lost.'}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}


            {/* Screenshot 2: Payment Sent Proof */}
            <ImageUploadBox
              type="payment"
              label="Payment Sent Screenshot"
              image={paymentProofImage}
              inputRef={paymentProofInputRef}
              cameraRef={paymentCameraInputRef}
            />

            {/* Reference */}
            <div className="grid gap-2">
              <Label htmlFor="payment_reference">Reference / Confirmation # (optional)</Label>
              <Input
                id="payment_reference"
                placeholder="Confirmation number or reference"
                value={paymentForm.payment_reference}
                onChange={(e) => setPaymentForm({ ...paymentForm, payment_reference: e.target.value })}
              />
            </div>

            {/* Notes — mandatory when amount doesn't match exactly */}
            {(() => {
              const owed = paymentForm.platform_amount && selectedAccount
                ? calculateAmountOwed(parseFloat(paymentForm.platform_amount), selectedAccount.percentage)
                : 0;
              const sent = parseFloat(paymentForm.amount_sent || '0');
              // 1-cent tolerance — anything within $0.01 counts as 'exact'
              // (avoids false mismatches from $34.605 owed vs $34.60 sent)
              const amountMismatch =
                paymentForm.amount_sent && paymentForm.platform_amount && Math.abs(sent - owed) >= 0.01;
              const isLess = !!amountMismatch && sent < owed;
              const isMore = !!amountMismatch && sent > owed;

              // Tailwind classes per case (less = yellow warning, more = blue info)
              const containerClass = isLess
                ? 'rounded-xl border-2 border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 p-4'
                : isMore
                ? 'rounded-xl border-2 border-blue-400 bg-blue-50 dark:bg-blue-950/30 p-4'
                : '';
              const labelClass = isLess
                ? 'text-base font-bold text-yellow-900 dark:text-yellow-200'
                : isMore
                ? 'text-base font-bold text-blue-900 dark:text-blue-200'
                : '';
              const helperClass = isLess
                ? 'text-xs text-yellow-800 dark:text-yellow-300'
                : isMore
                ? 'text-xs text-blue-800 dark:text-blue-300'
                : '';
              const inputClass = isLess
                ? 'border-yellow-400 bg-white dark:bg-background min-h-[80px]'
                : isMore
                ? 'border-blue-400 bg-white dark:bg-background min-h-[80px]'
                : '';

              const labelText = isLess
                ? '⚠️ Explain why you sent LESS *'
                : isMore
                ? 'ℹ️ Explain why you sent MORE *'
                : 'Notes (optional)';

              const helperText = isLess
                ? "The amount you sent doesn't match what you have to send. Please explain why you are sending less."
                : isMore
                ? "The amount you sent is greater than what you have to send. Please explain why you are sending more."
                : '';

              const placeholder = isLess
                ? 'e.g. I will pay the difference next week...'
                : isMore
                ? 'e.g. I overpaid by mistake, please apply credit...'
                : 'Any additional information...';

              return (
                <div className={`grid gap-2 ${containerClass}`}>
                  <Label htmlFor="notes" className={labelClass}>
                    {labelText}
                  </Label>
                  {amountMismatch && helperText && (
                    <p className={helperClass}>{helperText}</p>
                  )}
                  <Textarea
                    id="notes"
                    placeholder={placeholder}
                    value={paymentForm.notes}
                    onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                    className={inputClass}
                  />
                </div>
              );
            })()}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsPaymentDialogOpen(false);
                resetForm();
              }}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitPayment}
              disabled={(() => {
                // The note is mandatory whenever the amount sent doesn't match
                // what's owed — whether they sent MORE or LESS.
                const owed = selectedAccount && paymentForm.platform_amount
                  ? calculateAmountOwed(parseFloat(paymentForm.platform_amount), selectedAccount.percentage)
                  : 0;
                const sent = parseFloat(paymentForm.amount_sent || '0');
                const mismatch = !!paymentForm.amount_sent && Math.abs(sent - owed) >= 0.01;
                return (
                  !paymentForm.platform_amount ||
                  !paymentForm.amount_sent ||
                  !companyProofImage ||
                  !paymentProofImage ||
                  companyProofImage?.uploading ||
                  paymentProofImage?.uploading ||
                  isSubmitting ||
                  adminPaymentMethods.length === 0 ||
                  (mismatch && !paymentForm.notes.trim())
                );
              })()}
              className="w-full sm:w-auto"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Submit Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Schedule Dialog */}
      <Dialog open={isScheduleDialogOpen} onOpenChange={setIsScheduleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment Schedule</DialogTitle>
            <DialogDescription>
              {selectedAccount?.full_name} - {selectedAccount?.platform?.display_name}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="rounded-lg bg-muted p-4 mb-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Frequency:</span>
                <span className="font-medium">
                  {formatPaymentFrequency(selectedAccount?.payment_frequency || 'weekly')}
                </span>
                <span className="text-muted-foreground">Schedule:</span>
                <span>
                  {formatPaymentSchedule(
                    selectedAccount?.payment_frequency || 'weekly',
                    selectedAccount?.payment_day ?? 5,
                    selectedAccount?.biweekly_first_day,
                    selectedAccount?.biweekly_second_day
                  )}
                </span>
                <span className="text-muted-foreground">Your percentage:</span>
                <span className="font-semibold text-primary">{selectedAccount?.percentage}%</span>
              </div>
            </div>

            <h4 className="font-medium mb-3">Payment cycles:</h4>
            <div className="space-y-2">
              {selectedAccount && getScheduleTimeline(selectedAccount).map((c) => {
                const cfg = {
                  paid:     { badge: 'Confirmed', badgeClass: 'bg-green-600',  rowClass: 'bg-green-50 dark:bg-green-950/30', iconClass: 'text-green-600' },
                  reported: { badge: 'Reported',  badgeClass: 'bg-purple-600', rowClass: 'bg-purple-50 dark:bg-purple-950/30', iconClass: 'text-purple-600' },
                  issue:    { badge: 'Issue',     badgeClass: 'bg-amber-500',  rowClass: 'bg-amber-50 dark:bg-amber-950/30', iconClass: 'text-amber-600' },
                  missed:   { badge: 'Missed',    badgeClass: 'bg-red-600',    rowClass: 'bg-red-50 dark:bg-red-950/30', iconClass: 'text-red-600' },
                  due:      { badge: 'Due today', badgeClass: 'bg-yellow-500', rowClass: 'bg-yellow-50 dark:bg-yellow-950/30', iconClass: 'text-yellow-600' },
                  upcoming: { badge: '',          badgeClass: 'bg-muted',      rowClass: 'bg-muted', iconClass: 'text-muted-foreground' },
                }[c.status];
                return (
                  <div
                    key={c.str}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      c.isNext ? 'bg-green-100 dark:bg-green-900/30 ring-1 ring-green-400' : cfg.rowClass
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className={`h-4 w-4 ${c.isNext ? 'text-green-600' : cfg.iconClass}`} />
                      <div>
                        <p className={`font-medium ${c.isNext ? 'text-green-800 dark:text-green-300' : ''}`}>
                          {format(c.date, "EEEE, MMMM d", { locale: enUS })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(c.date, 'yyyy')}
                        </p>
                      </div>
                    </div>
                    {c.isNext ? (
                      <Badge className="bg-green-600">{c.status === 'due' ? 'Due today' : 'Next'}</Badge>
                    ) : cfg.badge ? (
                      <Badge className={cfg.badgeClass}>{cfg.badge}</Badge>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsScheduleDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* No Payment / Issue Dialog */}
      <Dialog open={isNoPaymentDialogOpen} onOpenChange={(open) => {
        setIsNoPaymentDialogOpen(open);
        if (!open) {
          setNoPaymentForm({ reason: '' });
          setSelectedCycleStr(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Report No Payment / Issue
            </DialogTitle>
            <DialogDescription>
              Report that you did not receive payment for {selectedAccount?.full_name}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Account Info */}
            <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Account:</span>
                <span className="font-medium">{selectedAccount?.full_name}</span>
                <span className="text-muted-foreground">Platform:</span>
                <span>{selectedAccount?.platform?.display_name}</span>
                <span className="text-muted-foreground">For cycle:</span>
                <span>
                  {selectedCycleStr
                    ? format(new Date(`${selectedCycleStr}T00:00:00`), "MMM d, yyyy", { locale: enUS })
                    : selectedAccount && format(getNextPayment(selectedAccount), "MMM d, yyyy", { locale: enUS })}
                </span>
              </div>
            </div>

            {/* Reason/Explanation */}
            <div className="grid gap-2">
              <Label htmlFor="no_payment_reason" className="text-red-600">
                Explanation *
              </Label>
              <Textarea
                id="no_payment_reason"
                placeholder="Explain why you didn't receive payment (e.g., company didn't pay, payment delayed, account issue, etc.)"
                value={noPaymentForm.reason}
                onChange={(e) => setNoPaymentForm({ reason: e.target.value })}
                className="min-h-[100px] border-red-200 focus:border-red-400 dark:border-red-800"
              />
              <p className="text-xs text-muted-foreground">
                This will be sent to admin for review
              </p>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsNoPaymentDialogOpen(false);
                setNoPaymentForm({ reason: '' });
              }}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!noPaymentForm.reason.trim()) {
                  alert('Please provide an explanation');
                  return;
                }

                setIsSubmitting(true);
                try {
                  // Create a payment record with status 'rejected' or special handling
                  const paymentData: Record<string, unknown> = {
                    user_id: user?.id,
                    account_id: selectedAccount?.id,
                    platform_amount: 0,
                    percentage_applied: selectedAccount?.percentage || 0,
                    amount_owed: 0,
                    amount_paid: 0,
                    payment_method: 'other',
                    user_notes: `NO PAYMENT RECEIVED: ${noPaymentForm.reason}`,
                    status: 'pending', // Admin will review this
                  };
                  // Tag the issue to the specific cycle being reported (so it
                  // satisfies/clears that cycle). null → server auto-tags nearest.
                  if (selectedCycleStr) {
                    paymentData.for_cycle_date = selectedCycleStr;
                  }

                  const response = await fetch('/api/payments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(paymentData),
                  });

                  const data = await response.json();

                  if (data.success) {
                    // Mark the cycle as reported on the card right away — the
                    // page used to stay unchanged here, which is what led users
                    // to report the same issue twice.
                    const created = data.data as Payment | undefined;
                    if (created?.id) {
                      setPayments(prev => (prev.some(p => p.id === created.id) ? prev : [created, ...prev]));
                    }
                    setIsNoPaymentDialogOpen(false);
                    setNoPaymentForm({ reason: '' });
                    setSelectedCycleStr(null);
                    alert(
                      data.duplicate
                        ? 'This issue was already reported a moment ago. No duplicate was created.'
                        : 'Issue reported successfully! Admin will review it.'
                    );
                    fetchData();
                  } else {
                    alert('Error: ' + (data.error || 'Failed to report issue'));
                  }
                } catch (error) {
                  console.error('Error reporting issue:', error);
                  alert('Error reporting issue. Please try again.');
                } finally {
                  setIsSubmitting(false);
                }
              }}
              disabled={!noPaymentForm.reason.trim() || isSubmitting}
              className="w-full sm:w-auto"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <AlertTriangle className="h-4 w-4 mr-2" />
              )}
              Report Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment History Dialog — all reports for an account, each clickable to
          drill into full details (mirrors the admin Payment History view). */}
      <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payment History</DialogTitle>
            <DialogDescription>
              {historyAccount?.full_name} — {historyAccount?.platform?.display_name}
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const history = historyAccount ? getAccountHistory(historyAccount) : [];

            if (history.length === 0) {
              return (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">No payments yet</p>
                  <p className="text-sm">You haven&apos;t reported any payments for this account.</p>
                </div>
              );
            }

            return (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {history.length} payment{history.length !== 1 ? 's' : ''} on record
                </p>
                {history.map((p) => {
                  const isIssue = p.status === 'pending';
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedReportPayment(p);
                        setSelectedAccount(historyAccount);
                        setIsHistoryDialogOpen(false);
                        setIsViewReportDialogOpen(true);
                      }}
                      className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">
                              {format(new Date(p.created_at), 'MMM d, yyyy', { locale: enUS })}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(p.created_at), 'HH:mm')}
                            </span>
                            <Badge className={
                              p.status === 'confirmed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                              p.status === 'rejected' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                              p.status === 'submitted' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                              'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                            }>
                              {p.status === 'submitted' ? 'Awaiting confirmation' :
                               p.status === 'confirmed' ? 'Confirmed' :
                               p.status === 'rejected' ? 'Rejected' :
                               'No Payment / Issue'}
                            </Badge>
                          </div>
                          {isIssue ? (
                            <div className="text-xs text-muted-foreground mt-1">
                              Issue reported — awaiting admin review
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
                              <span>Owed: ${Number(p.amount_owed || 0).toFixed(2)}</span>
                              <span>•</span>
                              <span>Paid: ${Number(p.amount_paid || 0).toFixed(2)}</span>
                              {p.payment_method && (
                                <>
                                  <span>•</span>
                                  <span className="capitalize">{p.payment_method}</span>
                                </>
                              )}
                            </div>
                          )}
                          {p.status === 'rejected' && p.rejection_reason && (
                            <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                              ❌ {p.rejection_reason}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-primary shrink-0">View details →</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsHistoryDialogOpen(false)} className="w-full sm:w-auto">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Report Dialog */}
      <Dialog open={isViewReportDialogOpen} onOpenChange={setIsViewReportDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payment Report</DialogTitle>
            <DialogDescription>
              {selectedAccount?.full_name} - {selectedAccount?.platform?.display_name}
            </DialogDescription>
          </DialogHeader>

          {selectedReportPayment && (
            <div className="space-y-4">
              {/* Status */}
              <div className="flex justify-center">
                <Badge className={`text-sm px-4 py-1 ${
                  selectedReportPayment.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                  selectedReportPayment.status === 'rejected' ? 'bg-red-100 text-red-800' :
                  selectedReportPayment.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                  'bg-purple-100 text-purple-800'
                }`}>
                  {selectedReportPayment.status === 'submitted' ? 'Awaiting Confirmation' :
                   selectedReportPayment.status === 'confirmed' ? 'Confirmed' :
                   selectedReportPayment.status === 'rejected' ? 'Rejected' :
                   selectedReportPayment.status === 'pending' ? 'No Payment / Issue' :
                   selectedReportPayment.status}
                </Badge>
              </div>

              {/* Details */}
              <div className="rounded-lg bg-muted p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reported on:</span>
                  <span>{format(new Date(selectedReportPayment.created_at), "MMM d, yyyy 'at' HH:mm")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Platform earnings:</span>
                  <span>${Number(selectedReportPayment.platform_amount || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Percentage:</span>
                  <span>{selectedReportPayment.percentage_applied}%</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Amount sent:</span>
                  <span className="text-primary">${Number(selectedReportPayment.amount_paid || 0).toFixed(2)}</span>
                </div>
                {selectedReportPayment.payment_method && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Method:</span>
                    <span className="capitalize">{selectedReportPayment.payment_method}</span>
                  </div>
                )}
                {selectedReportPayment.payment_reference && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Reference:</span>
                    <span className="font-mono text-xs">{selectedReportPayment.payment_reference}</span>
                  </div>
                )}
              </div>

              {/* Screenshots */}
              {(selectedReportPayment.company_screenshot_url || selectedReportPayment.payment_screenshot_url || selectedReportPayment.company_screenshot_file_id || selectedReportPayment.payment_screenshot_file_id) && (
                <div className="grid grid-cols-2 gap-2">
                  {(selectedReportPayment.company_screenshot_url || selectedReportPayment.company_screenshot_file_id) && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Company Payment</p>
                      <ScreenshotImage
                        url={selectedReportPayment.company_screenshot_url}
                        fileId={selectedReportPayment.company_screenshot_file_id}
                        alt="Company"
                        className="w-full rounded-lg border"
                      />
                    </div>
                  )}
                  {(selectedReportPayment.payment_screenshot_url || selectedReportPayment.payment_screenshot_file_id) && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Payment Sent</p>
                      <ScreenshotImage
                        url={selectedReportPayment.payment_screenshot_url}
                        fileId={selectedReportPayment.payment_screenshot_file_id}
                        alt="Payment"
                        className="w-full rounded-lg border"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {selectedReportPayment.user_notes && (
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground mb-1">Your notes:</p>
                  <p className="text-sm">{selectedReportPayment.user_notes}</p>
                </div>
              )}

              {/* Rejection reason — only when the admin rejected this report */}
              {selectedReportPayment.status === 'rejected' && selectedReportPayment.rejection_reason && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                  <p className="text-xs text-red-700 dark:text-red-400 mb-1 font-medium">Reason for rejection:</p>
                  <p className="text-sm text-red-700 dark:text-red-400">{selectedReportPayment.rejection_reason}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setIsViewReportDialogOpen(false)} className="w-full">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
