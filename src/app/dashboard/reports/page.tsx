'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Calendar,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  PieChart,
  BarChart3,
  Search,
  RefreshCw,
  Users,
  Building2,
  ImageIcon,
  ExternalLink,
  Send,
} from 'lucide-react';
import { format, startOfDay, startOfWeek, startOfMonth, startOfYear, isAfter, isBefore, endOfDay } from 'date-fns';
import type { Payment } from '@/lib/types';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { isCommissionAccount } from '@/lib/account-utils';
import { ScreenshotImage } from '@/components/ScreenshotImage';
import { getScreenshotSrc } from '@/lib/screenshots';
import { getCached, setCached, CACHE_KEYS } from '@/lib/client-cache';
import { useAuth } from '@/hooks/useAuth';
import { ImageLightbox } from '@/components/ImageLightbox';

type DateRange = 'today' | 'week' | 'month' | 'year' | 'custom';

type GroupSort =
  | 'paid-desc' | 'paid-asc'      // paid to me
  | 'earned-desc'                 // company paid
  | 'kept-desc'                   // kept by them (earned - owed)
  | 'underpaid-desc'              // still owed (loss)
  | 'overpaid-desc'               // overpaid (paid - owed)
  | 'name-asc' | 'name-desc';

// Sort grouped rows by a money dimension (high→low, or low→high for paid-asc)
// or by name (A→Z / Z→A).
function sortGroups<T extends { totalPaid: number; totalEarned: number; totalOwed: number; totalLoss: number }>(
  arr: T[], sort: GroupSort, nameOf: (x: T) => string
): T[] {
  const c = [...arr];
  if (sort === 'name-asc') return c.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  if (sort === 'name-desc') return c.sort((a, b) => nameOf(b).localeCompare(nameOf(a)));
  const val = (x: T): number => {
    switch (sort) {
      case 'earned-desc': return x.totalEarned;               // company paid
      case 'kept-desc': return x.totalEarned - x.totalOwed;   // kept by them
      case 'underpaid-desc': return x.totalLoss;              // still owed
      case 'overpaid-desc': return x.totalPaid - x.totalOwed; // overpaid
      default: return x.totalPaid;                            // paid to me
    }
  };
  if (sort === 'paid-asc') return c.sort((a, b) => val(a) - val(b));
  return c.sort((a, b) => val(b) - val(a)); // every other option is high→low
}

interface AccountSummary {
  accountId: string;
  accountName: string;
  accountEmail: string;
  platformName: string;
  userName: string;
  userUsername: string;
  payments: Payment[];
  totalEarned: number;
  totalOwed: number;
  totalPaid: number;
  totalLoss: number;
  paymentsCount: number;
  confirmedCount: number;
  pendingCount: number;
  rejectedCount: number;
}

interface UserSummary {
  userId: string;
  userName: string;
  userUsername: string;
  payments: Payment[];
  accountsCount: number;
  totalEarned: number;
  totalOwed: number;
  totalPaid: number;
  totalLoss: number;
  paymentsCount: number;
  complianceRate: number;
}

export default function ReportsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isPartner = user?.role === 'partner';
  // Seed from the shared cache so switching back to Reports renders instantly.
  const [payments, setPayments] = useState<Payment[]>(() => getCached<Payment[]>(CACHE_KEYS.payments) || []);
  const [loading, setLoading] = useState(() => getCached<Payment[]>(CACHE_KEYS.payments) === undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [activeView, setActiveView] = useState<'overview' | 'by-account' | 'by-user' | 'all'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [groupSort, setGroupSort] = useState<GroupSort>('paid-desc');
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cardFilter, setCardFilter] = useState<'all' | 'received' | 'pending' | 'losses'>('all');

  const applyCardFilter = (filter: 'all' | 'received' | 'pending' | 'losses') => {
    setCardFilter(filter);
    setActiveView('overview');
  };

  const openPaymentDetails = (payment: Payment) => {
    setSelectedPayment(payment);
    setDetailsOpen(true);
  };

  // List rows omit the screenshot URLs (they can be inline base64 images and
  // made the list 30+ MB). Load the full row when the details dialog opens.
  useEffect(() => {
    const p = selectedPayment;
    if (!p || !p.screenshots_deferred || !detailsOpen) return;
    let cancelled = false;
    fetch(`/api/payments/${p.id}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.success) return;
        setSelectedPayment((cur) => (cur && cur.id === p.id ? { ...cur, ...json.data, screenshots_deferred: false } : cur));
      })
      .catch((e) => console.error('Error loading payment details:', e));
    return () => {
      cancelled = true;
    };
  }, [selectedPayment?.id, selectedPayment?.screenshots_deferred, detailsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show screenshots in an in-app lightbox instead of opening a new tab —
  // /api/screenshot/[fileId] otherwise downloads the file instead of viewing it.
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const openImageInNewTab = (url: string) => {
    if (url) setLightboxSrc(url);
  };

  useEffect(() => {
    // Wait for auth so partner scoping is known before the first fetch.
    if (user) fetchPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function fetchPayments(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    try {
      const response = await fetch(isPartner ? `/api/payments?owner_id=${user!.id}` : '/api/payments');
      const data = await response.json();
      if (data.success) {
        setCached(CACHE_KEYS.payments, data.data || []);
        setPayments(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching payments:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const filteredPayments = useMemo(() => {
    if (dateRange === 'custom') {
      const from = customFrom ? startOfDay(new Date(customFrom + 'T00:00:00')) : null;
      const to = customTo ? endOfDay(new Date(customTo + 'T00:00:00')) : null;
      if (!from && !to) return payments;
      return payments.filter(p => {
        const d = new Date(p.created_at);
        if (from && isBefore(d, from)) return false;
        if (to && isAfter(d, to)) return false;
        return true;
      });
    }
    const now = new Date();
    let startDate: Date;
    switch (dateRange) {
      case 'today': startDate = startOfDay(now); break;
      case 'week': startDate = startOfWeek(now, { weekStartsOn: 1 }); break;
      case 'month': startDate = startOfMonth(now); break;
      case 'year': startDate = startOfYear(now); break;
      default: return payments;
    }
    return payments.filter(p => isAfter(new Date(p.created_at), startDate));
  }, [payments, dateRange, customFrom, customTo]);

  // Apply the search box to the underlying payments so the WHOLE page — the
  // summary cards, overview tables and every breakdown — reflects what you're
  // searching for, not just the table you happen to be on. Empty query = no-op.
  const searchedPayments = useMemo(() => {
    if (!searchQuery.trim()) return filteredPayments;
    const q = searchQuery.toLowerCase();
    return filteredPayments.filter(p =>
      (p.user?.telegram_first_name || '').toLowerCase().includes(q) ||
      (p.user?.telegram_username || '').toLowerCase().includes(q) ||
      (p.account?.full_name || '').toLowerCase().includes(q) ||
      (p.account?.platform?.display_name || '').toLowerCase().includes(q) ||
      (p.account?.account_email || '').toLowerCase().includes(q)
    );
  }, [filteredPayments, searchQuery]);

  // Split commission vs regular so income from Commission projects shows
  // separately on the Reports page (admin wants to see commission inflow
  // on its own, not mixed with payroll-style payments).
  const isCommissionPayment = (p: Payment) =>
    !!p.account && isCommissionAccount(p.account as { project?: { display_name?: string | null; name?: string | null } | null });

  const regularPayments = useMemo(
    () => searchedPayments.filter(p => !isCommissionPayment(p)),
    [searchedPayments]
  );
  const commissionPayments = useMemo(
    () => searchedPayments.filter(isCommissionPayment),
    [searchedPayments]
  );

  // Aggregate stats — regular payments only. Commission has its own totals.
  const stats = useMemo(() => ({
    // Rejected reports are invalid — exclude them from earnings/owed so they
    // don't inflate what you're owed (a rejected payment was never collectible).
    totalPlatformEarnings: regularPayments.filter(p => p.status !== 'rejected').reduce((s, p) => s + (Number(p.platform_amount) || 0), 0),
    totalOwed: regularPayments.filter(p => p.status !== 'rejected').reduce((s, p) => s + (Number(p.amount_owed) || 0), 0),
    totalReceived: regularPayments.filter(p => p.status === 'confirmed').reduce((s, p) => s + (Number(p.amount_paid) || 0), 0),
    totalPending: regularPayments.filter(p => p.status === 'submitted' || p.status === 'pending').reduce((s, p) => s + (Number(p.amount_owed) || 0), 0),
    totalLoss: regularPayments
      .filter(p => p.status === 'confirmed')
      .reduce((s, p) => s + Math.max(0, (Number(p.amount_owed) || 0) - (Number(p.amount_paid) || 0)), 0),
    paymentsCount: {
      total: regularPayments.length,
      confirmed: regularPayments.filter(p => p.status === 'confirmed').length,
      pending: regularPayments.filter(p => p.status === 'submitted' || p.status === 'pending').length,
      rejected: regularPayments.filter(p => p.status === 'rejected').length,
    },
  }), [regularPayments]);

  const commissionStats = useMemo(() => ({
    totalReceived: commissionPayments.filter(p => p.status === 'confirmed').reduce((s, p) => s + (Number(p.amount_paid) || 0), 0),
    totalPending: commissionPayments.filter(p => p.status === 'submitted' || p.status === 'pending').reduce((s, p) => s + (Number(p.amount_owed) || 0), 0),
    paymentsCount: commissionPayments.length,
    confirmedCount: commissionPayments.filter(p => p.status === 'confirmed').length,
  }), [commissionPayments]);

  // Commission summaries — same shape as the regular By Account / By User
  // tables but populated from commission payments only.
  const commissionAccountSummaries = useMemo<AccountSummary[]>(() => {
    const map = new Map<string, AccountSummary>();
    for (const p of commissionPayments) {
      const accountId = p.account_id || 'no-account';
      if (!map.has(accountId)) {
        map.set(accountId, {
          accountId,
          accountName: p.account?.full_name || 'No account',
          accountEmail: p.account?.account_email || '',
          platformName: p.account?.platform?.display_name || '-',
          userName: p.user?.telegram_first_name || 'Unknown',
          userUsername: p.user?.telegram_username || '',
          payments: [],
          totalEarned: 0,
          totalOwed: 0,
          totalPaid: 0,
          totalLoss: 0,
          paymentsCount: 0,
          confirmedCount: 0,
          pendingCount: 0,
          rejectedCount: 0,
        });
      }
      const s = map.get(accountId)!;
      s.payments.push(p);
      s.paymentsCount++;
      // Commission has no platform_amount / amount_owed concept — the
      // amount_paid IS the commission. Track it as totalPaid.
      if (p.status === 'confirmed') {
        s.confirmedCount++;
        s.totalPaid += Number(p.amount_paid) || 0;
      } else if (p.status === 'rejected') {
        s.rejectedCount++;
      } else {
        s.pendingCount++;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalPaid - a.totalPaid);
  }, [commissionPayments]);

  const commissionUserSummaries = useMemo<UserSummary[]>(() => {
    const map = new Map<string, UserSummary>();
    const accountsSeen = new Map<string, Set<string>>();
    for (const p of commissionPayments) {
      const userId = p.user_id;
      if (!userId) continue;
      if (!map.has(userId)) {
        map.set(userId, {
          userId,
          userName: p.user?.telegram_first_name || 'Unknown',
          userUsername: p.user?.telegram_username || '',
          payments: [],
          accountsCount: 0,
          totalEarned: 0,
          totalOwed: 0,
          totalPaid: 0,
          totalLoss: 0,
          paymentsCount: 0,
          complianceRate: 0,
        });
        accountsSeen.set(userId, new Set());
      }
      const s = map.get(userId)!;
      s.payments.push(p);
      s.paymentsCount++;
      if (p.account_id) accountsSeen.get(userId)!.add(p.account_id);
      if (p.status === 'confirmed') {
        s.totalPaid += Number(p.amount_paid) || 0;
      }
    }
    for (const [userId, s] of map.entries()) {
      s.accountsCount = accountsSeen.get(userId)!.size;
    }
    return Array.from(map.values()).sort((a, b) => b.totalPaid - a.totalPaid);
  }, [commissionPayments]);

  const collectionRate = stats.totalOwed > 0 ? ((stats.totalReceived / stats.totalOwed) * 100).toFixed(1) : '0';
  // Percentages for the Income Breakdown. Share/Kept are a slice of platform
  // earnings; Received/Pending/Losses are a slice of what you're owed.
  const ownerSharePct = stats.totalPlatformEarnings > 0 ? (stats.totalOwed / stats.totalPlatformEarnings) * 100 : 0;
  const receivedPct = stats.totalOwed > 0 ? (stats.totalReceived / stats.totalOwed) * 100 : 0;
  const pendingPct = stats.totalOwed > 0 ? (stats.totalPending / stats.totalOwed) * 100 : 0;
  const lossPct = stats.totalOwed > 0 ? (stats.totalLoss / stats.totalOwed) * 100 : 0;

  // Group by account — REGULAR accounts only. Commission has its own block.
  const accountSummaries = useMemo<AccountSummary[]>(() => {
    const map = new Map<string, AccountSummary>();
    for (const p of regularPayments) {
      const accountId = p.account_id || 'no-account';
      if (!map.has(accountId)) {
        map.set(accountId, {
          accountId,
          accountName: p.account?.full_name || 'No account',
          accountEmail: p.account?.account_email || '',
          platformName: p.account?.platform?.display_name || '-',
          userName: p.user?.telegram_first_name || 'Unknown',
          userUsername: p.user?.telegram_username || '',
          payments: [],
          totalEarned: 0,
          totalOwed: 0,
          totalPaid: 0,
          totalLoss: 0,
          paymentsCount: 0,
          confirmedCount: 0,
          pendingCount: 0,
          rejectedCount: 0,
        });
      }
      const s = map.get(accountId)!;
      s.payments.push(p);
      s.paymentsCount++;
      // Rejected reports are invalid — they don't count toward earnings/owed.
      if (p.status !== 'rejected') {
        s.totalEarned += Number(p.platform_amount) || 0;
        s.totalOwed += Number(p.amount_owed) || 0;
      }
      if (p.status === 'confirmed') {
        s.confirmedCount++;
        s.totalPaid += Number(p.amount_paid) || 0;
        s.totalLoss += Math.max(0, (Number(p.amount_owed) || 0) - (Number(p.amount_paid) || 0));
      } else if (p.status === 'rejected') {
        s.rejectedCount++;
      } else {
        s.pendingCount++;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalPaid - a.totalPaid);
  }, [regularPayments]);

  // Group by user — REGULAR accounts only.
  const userSummaries = useMemo<UserSummary[]>(() => {
    const map = new Map<string, UserSummary>();
    const accountsSeen = new Map<string, Set<string>>();
    for (const p of regularPayments) {
      const userId = p.user_id;
      if (!userId) continue;
      if (!map.has(userId)) {
        map.set(userId, {
          userId,
          userName: p.user?.telegram_first_name || 'Unknown',
          userUsername: p.user?.telegram_username || '',
          payments: [],
          accountsCount: 0,
          totalEarned: 0,
          totalOwed: 0,
          totalPaid: 0,
          totalLoss: 0,
          paymentsCount: 0,
          complianceRate: 0,
        });
        accountsSeen.set(userId, new Set());
      }
      const s = map.get(userId)!;
      s.payments.push(p);
      s.paymentsCount++;
      // Rejected reports are invalid — they don't count toward earnings/owed.
      if (p.status !== 'rejected') {
        s.totalEarned += Number(p.platform_amount) || 0;
        s.totalOwed += Number(p.amount_owed) || 0;
      }
      if (p.account_id) accountsSeen.get(userId)!.add(p.account_id);
      if (p.status === 'confirmed') {
        s.totalPaid += Number(p.amount_paid) || 0;
        s.totalLoss += Math.max(0, (Number(p.amount_owed) || 0) - (Number(p.amount_paid) || 0));
      }
    }
    for (const [userId, s] of map.entries()) {
      s.accountsCount = accountsSeen.get(userId)!.size;
      s.complianceRate = s.totalOwed > 0 ? (s.totalPaid / s.totalOwed) * 100 : 0;
    }
    return Array.from(map.values()).sort((a, b) => b.totalPaid - a.totalPaid);
  }, [regularPayments]);

  // Underpayers (people who consistently pay less than owed)
  const topUnderpayers = useMemo(() => {
    return userSummaries
      .filter(u => u.totalLoss > 0)
      .sort((a, b) => b.totalLoss - a.totalLoss)
      .slice(0, 10);
  }, [userSummaries]);

  // Underpaid individual payments — regular accounts only, commission
  // doesn't have an 'amount_owed' baseline.
  const underpaidPayments = useMemo(() => {
    return regularPayments
      .filter(p => p.status === 'confirmed' && (Number(p.amount_owed) || 0) > (Number(p.amount_paid) || 0))
      .sort((a, b) => {
        const lossA = (Number(a.amount_owed) || 0) - (Number(a.amount_paid) || 0);
        const lossB = (Number(b.amount_owed) || 0) - (Number(b.amount_paid) || 0);
        return lossB - lossA;
      });
  }, [regularPayments]);

  // Pending individual payments (awaiting confirmation)
  const pendingPayments = useMemo(() => {
    return searchedPayments
      .filter(p => p.status === 'submitted' || p.status === 'pending')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [searchedPayments]);

  // Recent received individual payments (confirmed)
  const recentReceivedPayments = useMemo(() => {
    return searchedPayments
      .filter(p => p.status === 'confirmed')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [searchedPayments]);

  // Search filter
  const filteredAccountSummaries = sortGroups(accountSummaries.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.accountName.toLowerCase().includes(q) ||
      s.userName.toLowerCase().includes(q) ||
      s.platformName.toLowerCase().includes(q) ||
      s.accountEmail.toLowerCase().includes(q)
    );
  }), groupSort, s => s.accountName);

  const filteredUserSummaries = sortGroups(userSummaries.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.userName.toLowerCase().includes(q) || s.userUsername.toLowerCase().includes(q);
  }), groupSort, s => s.userName);

  const sortControl = (
    <Select value={groupSort} onValueChange={(v) => setGroupSort(v as GroupSort)}>
      <SelectTrigger className="w-full sm:w-[190px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="paid-desc">Paid to me: high → low</SelectItem>
        <SelectItem value="paid-asc">Paid to me: low → high</SelectItem>
        <SelectItem value="earned-desc">Company paid: high → low</SelectItem>
        <SelectItem value="kept-desc">Kept by them: high → low</SelectItem>
        <SelectItem value="underpaid-desc">Still owed: high → low</SelectItem>
        <SelectItem value="overpaid-desc">Overpaid: high → low</SelectItem>
        <SelectItem value="name-asc">Name: A → Z</SelectItem>
        <SelectItem value="name-desc">Name: Z → A</SelectItem>
      </SelectContent>
    </Select>
  );

  const exportCSV = () => {
    const rows = [
      ['Date', 'User', 'Account', 'Platform', 'Status', 'Earned', 'Owed', 'Kept', 'Paid', 'Diff'],
      ...searchedPayments.map(p => [
        format(new Date(p.created_at), 'yyyy-MM-dd HH:mm'),
        p.user?.telegram_first_name || '',
        p.account?.full_name || '',
        p.account?.platform?.display_name || '',
        p.status,
        (Number(p.platform_amount) || 0).toFixed(2),
        (Number(p.amount_owed) || 0).toFixed(2),
        ((Number(p.platform_amount) || 0) - (Number(p.amount_owed) || 0)).toFixed(2),
        (Number(p.amount_paid) || 0).toFixed(2),
        ((Number(p.amount_paid) || 0) - (Number(p.amount_owed) || 0)).toFixed(2),
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Reports
          </h1>
          <p className="text-muted-foreground">
            Income summary and detailed analytics by account and user
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fetchPayments(true)} disabled={refreshing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" className="gap-2" onClick={exportCSV}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Date Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filter by:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Tabs value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
                <TabsList>
                  <TabsTrigger value="today">Today</TabsTrigger>
                  <TabsTrigger value="week">This Week</TabsTrigger>
                  <TabsTrigger value="month">This Month</TabsTrigger>
                  <TabsTrigger value="year">This Year</TabsTrigger>
                  <TabsTrigger value="custom">Custom</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {dateRange === 'custom' && (
              <DateRangePicker
                from={customFrom}
                to={customTo}
                onChange={(f, t) => {
                  setCustomFrom(f);
                  setCustomTo(t);
                }}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card
          className={`border-green-200 dark:border-green-800 cursor-pointer transition-all hover:shadow-md hover:border-green-400 ${cardFilter === 'received' ? 'ring-2 ring-green-500' : ''}`}
          onClick={() => applyCardFilter(cardFilter === 'received' ? 'all' : 'received')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Total Received
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">${stats.totalReceived.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">From {stats.paymentsCount.confirmed} confirmed payments →</p>
          </CardContent>
        </Card>
        <Card
          className={`border-yellow-200 dark:border-yellow-800 cursor-pointer transition-all hover:shadow-md hover:border-yellow-400 ${cardFilter === 'pending' ? 'ring-2 ring-yellow-500' : ''}`}
          onClick={() => applyCardFilter(cardFilter === 'pending' ? 'all' : 'pending')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-600" />
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">${stats.totalPending.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">{stats.paymentsCount.pending} payments awaiting →</p>
          </CardContent>
        </Card>
        <Card
          className={`border-red-200 dark:border-red-800 cursor-pointer transition-all hover:shadow-md hover:border-red-400 ${cardFilter === 'losses' ? 'ring-2 ring-red-500' : ''}`}
          onClick={() => applyCardFilter(cardFilter === 'losses' ? 'all' : 'losses')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-600" />
              Losses (Underpaid)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">${stats.totalLoss.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">View underpaid payments →</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/50 ${cardFilter === 'all' && activeView === 'overview' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => applyCardFilter('all')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <PieChart className="h-4 w-4" />
              Collection Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{collectionRate}%</div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-green-600 transition-all" style={{ width: `${Math.min(100, Number(collectionRate))}%` }} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Commission Income — separate from regular payments per admin
          request. These come from accounts on the 'Commission' project. */}
      {(commissionStats.paymentsCount > 0) && (
        <Card className="border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <DollarSign className="h-5 w-5" />
              Commission Income (separate from regular accounts)
            </CardTitle>
            <CardDescription className="text-xs">
              Income from accounts on the &ldquo;Commission&rdquo; project. Not included in the regular totals above or in the by-account / by-user breakdowns below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Top numbers */}
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
              <div className="rounded-lg bg-white dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3">
                <p className="text-xs text-muted-foreground">Received (confirmed)</p>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                  ${commissionStats.totalReceived.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {commissionStats.confirmedCount} confirmed
                </p>
              </div>
              <div className="rounded-lg bg-white dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3">
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">
                  ${commissionStats.totalPending.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {commissionPayments.length - commissionStats.confirmedCount} awaiting
                </p>
              </div>
              <div className="rounded-lg bg-white dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3">
                <p className="text-xs text-muted-foreground">Total reports</p>
                <p className="text-2xl font-bold">{commissionStats.paymentsCount}</p>
              </div>
            </div>

            {/* By Account & By User tables side by side on desktop */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg bg-white dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3">
                <p className="text-sm font-semibold mb-2 text-amber-800 dark:text-amber-300">By Commission Account</p>
                {commissionAccountSummaries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No commission accounts yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Account</TableHead>
                        <TableHead className="text-xs text-right">Received</TableHead>
                        <TableHead className="text-xs text-right">Reports</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissionAccountSummaries.map((s) => (
                        <TableRow key={s.accountId}>
                          <TableCell className="py-2">
                            <div className="text-sm font-medium">{s.accountName}</div>
                            <div className="text-xs text-muted-foreground">{s.platformName}</div>
                          </TableCell>
                          <TableCell className="py-2 text-right text-sm font-semibold text-amber-700 dark:text-amber-400">
                            ${s.totalPaid.toFixed(2)}
                          </TableCell>
                          <TableCell className="py-2 text-right text-xs text-muted-foreground">
                            {s.confirmedCount}/{s.paymentsCount}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="rounded-lg bg-white dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3">
                <p className="text-sm font-semibold mb-2 text-amber-800 dark:text-amber-300">By User</p>
                {commissionUserSummaries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No users reporting commission yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">User</TableHead>
                        <TableHead className="text-xs text-right">Received</TableHead>
                        <TableHead className="text-xs text-right">Accts</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissionUserSummaries.map((s) => (
                        <TableRow key={s.userId}>
                          <TableCell className="py-2">
                            <div className="text-sm font-medium">{s.userName}</div>
                            {s.userUsername && (
                              <div className="text-xs text-muted-foreground">@{s.userUsername}</div>
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-right text-sm font-semibold text-amber-700 dark:text-amber-400">
                            ${s.totalPaid.toFixed(2)}
                          </TableCell>
                          <TableCell className="py-2 text-right text-xs text-muted-foreground">
                            {s.accountsCount}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active filter badge */}
      {cardFilter !== 'all' && activeView === 'overview' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Showing only:</span>
          <Badge variant="outline" className="gap-1 cursor-pointer" onClick={() => setCardFilter('all')}>
            {cardFilter === 'received' && <><TrendingUp className="h-3 w-3 text-green-600" /> Total Received</>}
            {cardFilter === 'pending' && <><Clock className="h-3 w-3 text-yellow-600" /> Pending Payments</>}
            {cardFilter === 'losses' && <><TrendingDown className="h-3 w-3 text-red-600" /> Underpaid Payments</>}
            <XCircle className="h-3 w-3 ml-1" />
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => setCardFilter('all')}>Show all</Button>
        </div>
      )}

      {/* View Tabs */}
      <Tabs value={activeView} onValueChange={(v) => setActiveView(v as typeof activeView)}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="by-account">By Account</TabsTrigger>
            <TabsTrigger value="by-user">By User</TabsTrigger>
            <TabsTrigger value="all">All Payments</TabsTrigger>
          </TabsList>
          {/* Search is always visible: it now filters the summary cards and
              every tab at once, not just the breakdown tables. */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search user, account, platform..." className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
        </div>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {cardFilter === 'all' && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Income Breakdown</CardTitle>
                <CardDescription>Summary of platform earnings and your share</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted">
                  <span className="text-muted-foreground">Total Platform Earnings</span>
                  <span className="font-bold text-lg">${stats.totalPlatformEarnings.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted">
                  <div>
                    <span className="text-muted-foreground">Your Share (Owed)</span>
                    <p className="text-xs text-muted-foreground">{ownerSharePct.toFixed(1)}% of platform earnings</p>
                  </div>
                  <span className="font-bold text-lg">${stats.totalOwed.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted">
                  <div>
                    <span className="text-muted-foreground">Kept by Accounts</span>
                    <p className="text-xs text-muted-foreground">{(100 - ownerSharePct).toFixed(1)}% of platform earnings</p>
                  </div>
                  <span className="font-bold text-lg">${(stats.totalPlatformEarnings - stats.totalOwed).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-green-100 dark:bg-green-900/30">
                  <div>
                    <span className="text-green-800 dark:text-green-300">Actually Received</span>
                    <p className="text-xs text-green-700/80 dark:text-green-400/80">{receivedPct.toFixed(1)}% of owed · confirmed</p>
                  </div>
                  <span className="font-bold text-lg text-green-600">${stats.totalReceived.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
                  <div>
                    <span className="text-yellow-800 dark:text-yellow-300">Pending (not yet received)</span>
                    <p className="text-xs text-yellow-700/80 dark:text-yellow-400/80">{pendingPct.toFixed(1)}% of owed · awaiting confirmation</p>
                  </div>
                  <span className="font-bold text-lg text-yellow-600">${stats.totalPending.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-red-100 dark:bg-red-900/30">
                  <div>
                    <span className="text-red-800 dark:text-red-300">Losses (Underpaid)</span>
                    <p className="text-xs text-red-700/80 dark:text-red-400/80">{lossPct.toFixed(1)}% of owed · confirmed but paid short</p>
                  </div>
                  <span className="font-bold text-lg text-red-600">-${stats.totalLoss.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Payment Status</CardTitle>
                <CardDescription>Breakdown by status — click to filter</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all hover:bg-green-50 dark:hover:bg-green-900/20" onClick={() => router.push('/dashboard/payments?status=confirmed')}>
                  <div className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-green-600" /><span>Confirmed</span></div>
                  <Badge className="bg-green-100 text-green-800">{stats.paymentsCount.confirmed}</Badge>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all hover:bg-yellow-50 dark:hover:bg-yellow-900/20" onClick={() => router.push('/dashboard/payments?status=submitted')}>
                  <div className="flex items-center gap-3"><Clock className="h-5 w-5 text-yellow-600" /><span>Pending / To Confirm</span></div>
                  <Badge className="bg-yellow-100 text-yellow-800">{stats.paymentsCount.pending}</Badge>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => router.push('/dashboard/payments?status=rejected')}>
                  <div className="flex items-center gap-3"><XCircle className="h-5 w-5 text-red-600" /><span>Rejected</span></div>
                  <Badge className="bg-red-100 text-red-800">{stats.paymentsCount.rejected}</Badge>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted cursor-pointer transition-all hover:bg-muted/80" onClick={() => router.push('/dashboard/payments?status=all')}>
                  <span className="font-medium">Total Payments</span>
                  <span className="font-bold">{stats.paymentsCount.total} →</span>
                </div>
              </CardContent>
            </Card>
          </div>
          )}

          {/* Top Underpayers (by user) */}
          {(cardFilter === 'all' || cardFilter === 'losses') && topUnderpayers.length > 0 && (
            <Card className="border-red-200 dark:border-red-800">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                  Top Underpayers
                </CardTitle>
                <CardDescription>Users who consistently pay less than owed</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead className="text-right">Total Owed</TableHead>
                      <TableHead className="text-right">Total Paid</TableHead>
                      <TableHead className="text-right">Loss</TableHead>
                      <TableHead className="text-right">Compliance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topUnderpayers.map(u => (
                      <TableRow key={u.userId}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{u.userName}</p>
                            <p className="text-xs text-muted-foreground">@{u.userUsername}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">${u.totalOwed.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${u.totalPaid.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-red-600 font-semibold">-${u.totalLoss.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <Badge className={u.complianceRate >= 90 ? 'bg-green-100 text-green-800' : u.complianceRate >= 70 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}>
                            {u.complianceRate.toFixed(0)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Underpaid Payments (individual, clickable) */}
          {(cardFilter === 'all' || cardFilter === 'losses') && underpaidPayments.length > 0 && (
            <Card className="border-red-200 dark:border-red-800">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-red-600" />
                  Underpaid Payments
                </CardTitle>
                <CardDescription>Click any row to see screenshots and full details</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead className="text-right">Owed</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Loss</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {underpaidPayments.map(p => {
                      const owed = Number(p.amount_owed) || 0;
                      const paid = Number(p.amount_paid) || 0;
                      const loss = owed - paid;
                      const hasScreenshots = p.has_company_screenshot || p.has_payment_screenshot || p.company_screenshot_file_id || p.payment_screenshot_file_id || p.company_screenshot_url || p.payment_screenshot_url || p.screenshot_url;
                      return (
                        <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openPaymentDetails(p)}>
                          <TableCell className="text-xs">{format(new Date(p.created_at), 'MMM d, HH:mm')}</TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{p.account?.full_name || '-'}</p>
                              <p className="text-xs text-muted-foreground">{p.account?.platform?.display_name || ''}</p>
                            </div>
                          </TableCell>
                          <TableCell>{p.user?.telegram_first_name || '-'}</TableCell>
                          <TableCell className="text-right">${owed.toFixed(2)}</TableCell>
                          <TableCell className="text-right">${paid.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-red-600 font-semibold">-${loss.toFixed(2)}</TableCell>
                          <TableCell>{hasScreenshots && <ImageIcon className="h-4 w-4 text-muted-foreground" />}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Pending Payments (clickable) */}
          {(cardFilter === 'all' || cardFilter === 'pending') && pendingPayments.length > 0 && (
            <Card className="border-yellow-200 dark:border-yellow-800">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-600" />
                  Pending Payments
                </CardTitle>
                <CardDescription>Awaiting your confirmation — click any row for details</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Owed</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingPayments.map(p => {
                      const hasScreenshots = p.has_company_screenshot || p.has_payment_screenshot || p.company_screenshot_file_id || p.payment_screenshot_file_id || p.company_screenshot_url || p.payment_screenshot_url || p.screenshot_url;
                      return (
                        <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openPaymentDetails(p)}>
                          <TableCell className="text-xs">{format(new Date(p.created_at), 'MMM d, HH:mm')}</TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{p.account?.full_name || '-'}</p>
                              <p className="text-xs text-muted-foreground">{p.account?.platform?.display_name || ''}</p>
                            </div>
                          </TableCell>
                          <TableCell>{p.user?.telegram_first_name || '-'}</TableCell>
                          <TableCell><span className="text-xs capitalize">{p.payment_method || '-'}</span></TableCell>
                          <TableCell className="text-right">${(Number(p.amount_owed) || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">${(Number(p.amount_paid) || 0).toFixed(2)}</TableCell>
                          <TableCell>{hasScreenshots && <ImageIcon className="h-4 w-4 text-muted-foreground" />}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Recent Received Payments (clickable) */}
          {(cardFilter === 'all' || cardFilter === 'received') && recentReceivedPayments.length > 0 && (
            <Card className="border-green-200 dark:border-green-800">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Total Received
                </CardTitle>
                <CardDescription>Confirmed payments — click any row for details and screenshots</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Owed</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Diff</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentReceivedPayments.map(p => {
                      const owed = Number(p.amount_owed) || 0;
                      const paid = Number(p.amount_paid) || 0;
                      const diff = paid - owed;
                      const hasScreenshots = p.has_company_screenshot || p.has_payment_screenshot || p.company_screenshot_file_id || p.payment_screenshot_file_id || p.company_screenshot_url || p.payment_screenshot_url || p.screenshot_url;
                      return (
                        <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openPaymentDetails(p)}>
                          <TableCell className="text-xs">{format(new Date(p.created_at), 'MMM d, HH:mm')}</TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{p.account?.full_name || '-'}</p>
                              <p className="text-xs text-muted-foreground">{p.account?.platform?.display_name || ''}</p>
                            </div>
                          </TableCell>
                          <TableCell>{p.user?.telegram_first_name || '-'}</TableCell>
                          <TableCell><span className="text-xs capitalize">{p.payment_method || '-'}</span></TableCell>
                          <TableCell className="text-right">${owed.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium text-green-600">${paid.toFixed(2)}</TableCell>
                          <TableCell className={`text-right text-xs font-semibold ${diff < 0 ? 'text-red-600' : diff > 0 ? 'text-blue-600' : 'text-muted-foreground'}`}>
                            {diff >= 0 ? '+' : ''}${diff.toFixed(2)}
                          </TableCell>
                          <TableCell>{hasScreenshots && <ImageIcon className="h-4 w-4 text-muted-foreground" />}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* BY ACCOUNT TAB */}
        <TabsContent value="by-account" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Breakdown by Account
                  </CardTitle>
                  <CardDescription>{filteredAccountSummaries.length} accounts with activity in selected period</CardDescription>
                </div>
                {sortControl}
              </div>
            </CardHeader>
            <CardContent>
              {filteredAccountSummaries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No accounts with payments in this period</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Assigned to</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-center">Payments</TableHead>
                      <TableHead className="text-right">Earned</TableHead>
                      <TableHead className="text-right">Owed</TableHead>
                      <TableHead className="text-right">Kept</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Diff</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAccountSummaries.map(s => {
                      const diff = s.totalPaid - s.totalOwed;
                      return (
                        <TableRow key={s.accountId} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push('/dashboard/payments')}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{s.accountName}</p>
                              <p className="text-xs text-muted-foreground">{s.accountEmail}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="text-sm">{s.userName}</p>
                              {s.userUsername && <p className="text-xs text-muted-foreground">@{s.userUsername}</p>}
                            </div>
                          </TableCell>
                          <TableCell><Badge variant="outline">{s.platformName}</Badge></TableCell>
                          <TableCell className="text-center">
                            <div className="flex flex-col items-center text-xs">
                              <span className="font-medium">{s.paymentsCount}</span>
                              <span className="text-muted-foreground">
                                {s.confirmedCount}✓ {s.pendingCount}⏳ {s.rejectedCount}✗
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">${s.totalEarned.toFixed(2)}</TableCell>
                          <TableCell className="text-right">${s.totalOwed.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">${(s.totalEarned - s.totalOwed).toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">${s.totalPaid.toFixed(2)}</TableCell>
                          <TableCell className={`text-right font-semibold ${diff < 0 ? 'text-red-600' : diff > 0 ? 'text-blue-600' : ''}`}>
                            {diff >= 0 ? '+' : ''}${diff.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* BY USER TAB */}
        <TabsContent value="by-user" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Breakdown by User
                  </CardTitle>
                  <CardDescription>{filteredUserSummaries.length} users with activity in selected period</CardDescription>
                </div>
                {sortControl}
              </div>
            </CardHeader>
            <CardContent>
              {filteredUserSummaries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No users with payments in this period</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead className="text-center">Accounts</TableHead>
                      <TableHead className="text-center">Payments</TableHead>
                      <TableHead className="text-right">Earned</TableHead>
                      <TableHead className="text-right">Owed</TableHead>
                      <TableHead className="text-right">Kept</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Loss</TableHead>
                      <TableHead className="text-right">Compliance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUserSummaries.map(u => (
                      <TableRow key={u.userId}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{u.userName}</p>
                            {u.userUsername && <p className="text-xs text-muted-foreground">@{u.userUsername}</p>}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">{u.accountsCount}</TableCell>
                        <TableCell className="text-center">{u.paymentsCount}</TableCell>
                        <TableCell className="text-right">${u.totalEarned.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${u.totalOwed.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">${(u.totalEarned - u.totalOwed).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-medium">${u.totalPaid.toFixed(2)}</TableCell>
                        <TableCell className={`text-right font-semibold ${u.totalLoss > 0 ? 'text-red-600' : ''}`}>
                          {u.totalLoss > 0 ? `-$${u.totalLoss.toFixed(2)}` : '$0.00'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge className={u.complianceRate >= 90 ? 'bg-green-100 text-green-800' : u.complianceRate >= 70 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}>
                            {u.complianceRate.toFixed(0)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ALL PAYMENTS TAB */}
        <TabsContent value="all" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">All Payments</CardTitle>
              <CardDescription>{searchedPayments.length} payments in selected period</CardDescription>
            </CardHeader>
            <CardContent>
              {searchedPayments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No payments in this period</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-right">Earned</TableHead>
                      <TableHead className="text-right">Owed</TableHead>
                      <TableHead className="text-right">Kept</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Diff</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchedPayments
                      .map(p => {
                        const diff = (Number(p.amount_paid) || 0) - (Number(p.amount_owed) || 0);
                        return (
                          <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openPaymentDetails(p)}>
                            <TableCell className="text-xs">{format(new Date(p.created_at), 'MMM d, HH:mm')}</TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium">{p.account?.full_name || '-'}</p>
                                <p className="text-xs text-muted-foreground">{p.account?.account_email || ''}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="text-sm">{p.user?.telegram_first_name || '-'}</p>
                                {p.user?.telegram_username && <p className="text-xs text-muted-foreground">@{p.user.telegram_username}</p>}
                              </div>
                            </TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{p.account?.platform?.display_name || '-'}</Badge></TableCell>
                            <TableCell className="text-right">${(Number(p.platform_amount) || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-right">${(Number(p.amount_owed) || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-right text-muted-foreground">${((Number(p.platform_amount) || 0) - (Number(p.amount_owed) || 0)).toFixed(2)}</TableCell>
                            <TableCell className="text-right font-medium">${(Number(p.amount_paid) || 0).toFixed(2)}</TableCell>
                            <TableCell className={`text-right text-xs font-semibold ${diff < 0 ? 'text-red-600' : diff > 0 ? 'text-blue-600' : 'text-muted-foreground'}`}>
                              {p.status === 'confirmed' ? `${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell>
                              <Badge className={p.status === 'confirmed' ? 'bg-green-100 text-green-800' : p.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}>
                                {p.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payment Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payment Details</DialogTitle>
            <DialogDescription>
              {selectedPayment?.account?.full_name || 'Account'} - {selectedPayment?.account?.platform?.display_name || 'Platform'}
            </DialogDescription>
          </DialogHeader>

          {selectedPayment && (
            <div className="space-y-4">
              {/* Status */}
              <div className="flex justify-center">
                <Badge className={`text-sm px-4 py-1 ${
                  selectedPayment.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                  selectedPayment.status === 'rejected' ? 'bg-red-100 text-red-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {selectedPayment.status === 'submitted' ? 'Awaiting Confirmation' : selectedPayment.status}
                </Badge>
              </div>

              {/* User & Account */}
              <div className="rounded-lg bg-muted p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">User:</span><span className="font-medium">{selectedPayment.user?.telegram_first_name || '-'}{selectedPayment.user?.telegram_username ? ` (@${selectedPayment.user.telegram_username})` : ''}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Account:</span><span className="font-medium">{selectedPayment.account?.full_name || '-'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Email:</span><span className="text-xs">{selectedPayment.account?.account_email || '-'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Platform:</span><span>{selectedPayment.account?.platform?.display_name || '-'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Date:</span><span>{format(new Date(selectedPayment.created_at), "MMMM d, yyyy 'at' HH:mm")}</span></div>
              </div>

              {/* Amounts */}
              <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Platform Earnings:</span><span className="font-medium">${Number(selectedPayment.platform_amount || 0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Percentage:</span><span>{selectedPayment.percentage_applied}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Should Pay:</span><span className="font-bold">${Number(selectedPayment.amount_owed || 0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Actually Sent:</span><span className="font-bold text-primary">${Number(selectedPayment.amount_paid || 0).toFixed(2)}</span></div>
                {Number(selectedPayment.amount_owed) !== Number(selectedPayment.amount_paid) && (
                  <div className="flex justify-between pt-2 border-t">
                    <span className="text-muted-foreground">Difference:</span>
                    <span className={`font-bold ${Number(selectedPayment.amount_paid) >= Number(selectedPayment.amount_owed) ? 'text-blue-600' : 'text-red-600'}`}>
                      {Number(selectedPayment.amount_paid) >= Number(selectedPayment.amount_owed) ? '+' : '-'}
                      ${Math.abs(Number(selectedPayment.amount_paid || 0) - Number(selectedPayment.amount_owed || 0)).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {/* Method & Reference */}
              {(selectedPayment.payment_method || selectedPayment.payment_reference) && (
                <div className="rounded-lg bg-muted p-3 space-y-1 text-sm">
                  {selectedPayment.payment_method && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Method:</span><span className="capitalize">{selectedPayment.payment_method}</span></div>
                  )}
                  {selectedPayment.payment_reference && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Reference:</span><span className="font-mono text-xs break-all">{selectedPayment.payment_reference}</span></div>
                  )}
                </div>
              )}

              {/* Screenshots */}
              {(selectedPayment.company_screenshot_url || selectedPayment.payment_screenshot_url || selectedPayment.screenshot_url ||
                selectedPayment.company_screenshot_file_id || selectedPayment.payment_screenshot_file_id) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(() => {
                    const companyUrl = selectedPayment.company_screenshot_url || selectedPayment.screenshot_url;
                    const companySrc = getScreenshotSrc(companyUrl, selectedPayment.company_screenshot_file_id);
                    if (!companySrc) return null;
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" /> Company Payment</p>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openImageInNewTab(companySrc)}>
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </div>
                        <button type="button" onClick={() => setLightboxSrc(companySrc)} className="block w-full cursor-zoom-in" title="View full size">
                          <ScreenshotImage url={companyUrl} fileId={selectedPayment.company_screenshot_file_id} alt="Company" className="w-full rounded-lg border" />
                        </button>
                      </div>
                    );
                  })()}
                  {(() => {
                    const paymentSrc = getScreenshotSrc(selectedPayment.payment_screenshot_url, selectedPayment.payment_screenshot_file_id);
                    if (!paymentSrc) return null;
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs text-muted-foreground flex items-center gap-1"><Send className="h-3 w-3" /> Payment Sent</p>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openImageInNewTab(paymentSrc)}>
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </div>
                        <button type="button" onClick={() => setLightboxSrc(paymentSrc)} className="block w-full cursor-zoom-in" title="View full size">
                          <ScreenshotImage url={selectedPayment.payment_screenshot_url} fileId={selectedPayment.payment_screenshot_file_id} alt="Payment" className="w-full rounded-lg border" />
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Notes */}
              {selectedPayment.user_notes && (
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground mb-1">User notes:</p>
                  <p className="text-sm">{selectedPayment.user_notes}</p>
                </div>
              )}
              {selectedPayment.admin_notes && (
                <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3">
                  <p className="text-xs text-blue-700 dark:text-blue-400 mb-1">Admin notes:</p>
                  <p className="text-sm">{selectedPayment.admin_notes}</p>
                </div>
              )}
              {selectedPayment.status === 'rejected' && selectedPayment.rejection_reason && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                  <p className="text-xs text-red-700 dark:text-red-400 font-medium mb-1">Rejection reason:</p>
                  <p className="text-sm">{selectedPayment.rejection_reason}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {selectedPayment?.status === 'submitted' && (
              <Button
                onClick={() => router.push(`/dashboard/payments?payment=${selectedPayment.id}`)}
                className="w-full sm:w-auto"
              >
                Review & Confirm in Payments →
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailsOpen(false)} className="w-full sm:w-auto">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
