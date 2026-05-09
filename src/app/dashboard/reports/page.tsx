'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  Users,
  Building2,
  ImageIcon,
  ExternalLink,
  Send,
} from 'lucide-react';
import { format, startOfDay, startOfWeek, startOfMonth, startOfYear, isAfter } from 'date-fns';
import type { Payment } from '@/lib/types';

type DateRange = 'today' | 'week' | 'month' | 'year' | 'all';

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
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState((new Date().getMonth() + 1).toString());
  const [activeView, setActiveView] = useState<'overview' | 'by-account' | 'by-user' | 'all'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
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

  const openImageInNewTab = (url: string) => {
    if (!url) return;
    if (url.startsWith('data:')) {
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(`<!DOCTYPE html><html><head><title>Screenshot</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1a1a1a}img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body><img src="${url}"/></body></html>`);
        w.document.close();
      }
    } else {
      window.open(url, '_blank');
    }
  };

  useEffect(() => {
    fetchPayments();
  }, []);

  async function fetchPayments() {
    try {
      const response = await fetch('/api/payments');
      const data = await response.json();
      if (data.success) {
        setPayments(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching payments:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredPayments = useMemo(() => {
    if (dateRange === 'all') {
      return payments.filter(p => {
        const d = new Date(p.created_at);
        return d.getFullYear() === parseInt(selectedYear) && d.getMonth() + 1 === parseInt(selectedMonth);
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
  }, [payments, dateRange, selectedYear, selectedMonth]);

  // Aggregate stats
  const stats = useMemo(() => ({
    totalPlatformEarnings: filteredPayments.reduce((s, p) => s + (Number(p.platform_amount) || 0), 0),
    totalOwed: filteredPayments.reduce((s, p) => s + (Number(p.amount_owed) || 0), 0),
    totalReceived: filteredPayments.filter(p => p.status === 'confirmed').reduce((s, p) => s + (Number(p.amount_paid) || 0), 0),
    totalPending: filteredPayments.filter(p => p.status === 'submitted' || p.status === 'pending').reduce((s, p) => s + (Number(p.amount_owed) || 0), 0),
    totalLoss: filteredPayments
      .filter(p => p.status === 'confirmed')
      .reduce((s, p) => s + Math.max(0, (Number(p.amount_owed) || 0) - (Number(p.amount_paid) || 0)), 0),
    paymentsCount: {
      total: filteredPayments.length,
      confirmed: filteredPayments.filter(p => p.status === 'confirmed').length,
      pending: filteredPayments.filter(p => p.status === 'submitted' || p.status === 'pending').length,
      rejected: filteredPayments.filter(p => p.status === 'rejected').length,
    },
  }), [filteredPayments]);

  const collectionRate = stats.totalOwed > 0 ? ((stats.totalReceived / stats.totalOwed) * 100).toFixed(1) : '0';

  // Group by account
  const accountSummaries = useMemo<AccountSummary[]>(() => {
    const map = new Map<string, AccountSummary>();
    for (const p of filteredPayments) {
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
      s.totalEarned += Number(p.platform_amount) || 0;
      s.totalOwed += Number(p.amount_owed) || 0;
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
  }, [filteredPayments]);

  // Group by user
  const userSummaries = useMemo<UserSummary[]>(() => {
    const map = new Map<string, UserSummary>();
    const accountsSeen = new Map<string, Set<string>>();
    for (const p of filteredPayments) {
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
      s.totalEarned += Number(p.platform_amount) || 0;
      s.totalOwed += Number(p.amount_owed) || 0;
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
  }, [filteredPayments]);

  // Underpayers (people who consistently pay less than owed)
  const topUnderpayers = useMemo(() => {
    return userSummaries
      .filter(u => u.totalLoss > 0)
      .sort((a, b) => b.totalLoss - a.totalLoss)
      .slice(0, 10);
  }, [userSummaries]);

  // Underpaid individual payments (clickable for screenshots)
  const underpaidPayments = useMemo(() => {
    return filteredPayments
      .filter(p => p.status === 'confirmed' && (Number(p.amount_owed) || 0) > (Number(p.amount_paid) || 0))
      .sort((a, b) => {
        const lossA = (Number(a.amount_owed) || 0) - (Number(a.amount_paid) || 0);
        const lossB = (Number(b.amount_owed) || 0) - (Number(b.amount_paid) || 0);
        return lossB - lossA;
      });
  }, [filteredPayments]);

  // Pending individual payments (awaiting confirmation)
  const pendingPayments = useMemo(() => {
    return filteredPayments
      .filter(p => p.status === 'submitted' || p.status === 'pending')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [filteredPayments]);

  // Recent received individual payments (confirmed)
  const recentReceivedPayments = useMemo(() => {
    return filteredPayments
      .filter(p => p.status === 'confirmed')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [filteredPayments]);

  // Search filter
  const filteredAccountSummaries = accountSummaries.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.accountName.toLowerCase().includes(q) ||
      s.userName.toLowerCase().includes(q) ||
      s.platformName.toLowerCase().includes(q) ||
      s.accountEmail.toLowerCase().includes(q)
    );
  });

  const filteredUserSummaries = userSummaries.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.userName.toLowerCase().includes(q) || s.userUsername.toLowerCase().includes(q);
  });

  const exportCSV = () => {
    const rows = [
      ['Date', 'User', 'Account', 'Platform', 'Status', 'Earned', 'Owed', 'Paid', 'Diff'],
      ...filteredPayments.map(p => [
        format(new Date(p.created_at), 'yyyy-MM-dd HH:mm'),
        p.user?.telegram_first_name || '',
        p.account?.full_name || '',
        p.account?.platform?.display_name || '',
        p.status,
        (Number(p.platform_amount) || 0).toFixed(2),
        (Number(p.amount_owed) || 0).toFixed(2),
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

  const availableYears = [...new Set(payments.map(p => new Date(p.created_at).getFullYear()))].sort((a, b) => b - a);
  if (availableYears.length === 0) availableYears.push(new Date().getFullYear());
  const months = [
    { value: '1', label: 'January' }, { value: '2', label: 'February' }, { value: '3', label: 'March' },
    { value: '4', label: 'April' }, { value: '5', label: 'May' }, { value: '6', label: 'June' },
    { value: '7', label: 'July' }, { value: '8', label: 'August' }, { value: '9', label: 'September' },
    { value: '10', label: 'October' }, { value: '11', label: 'November' }, { value: '12', label: 'December' },
  ];

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
        <Button variant="outline" className="gap-2" onClick={exportCSV}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
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
                  <TabsTrigger value="all">Custom</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {dateRange === 'all' && (
              <div className="flex gap-2">
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{availableYears.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
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
          {(activeView === 'by-account' || activeView === 'by-user' || activeView === 'all') && (
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search..." className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
          )}
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
                  <span className="text-muted-foreground">Your Share (Owed)</span>
                  <span className="font-bold text-lg">${stats.totalOwed.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-green-100 dark:bg-green-900/30">
                  <span className="text-green-800 dark:text-green-300">Actually Received</span>
                  <span className="font-bold text-lg text-green-600">${stats.totalReceived.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-red-100 dark:bg-red-900/30">
                  <span className="text-red-800 dark:text-red-300">Losses (Underpaid)</span>
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
                      const hasScreenshots = p.company_screenshot_url || p.payment_screenshot_url || p.screenshot_url;
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
                      const hasScreenshots = p.company_screenshot_url || p.payment_screenshot_url || p.screenshot_url;
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
                      const hasScreenshots = p.company_screenshot_url || p.payment_screenshot_url || p.screenshot_url;
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
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Breakdown by Account
              </CardTitle>
              <CardDescription>{filteredAccountSummaries.length} accounts with activity in selected period</CardDescription>
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
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Breakdown by User
              </CardTitle>
              <CardDescription>{filteredUserSummaries.length} users with activity in selected period</CardDescription>
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
              <CardDescription>{filteredPayments.length} payments in selected period</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredPayments.length === 0 ? (
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
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Diff</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayments
                      .filter(p => {
                        if (!searchQuery) return true;
                        const q = searchQuery.toLowerCase();
                        return (
                          (p.user?.telegram_first_name || '').toLowerCase().includes(q) ||
                          (p.account?.full_name || '').toLowerCase().includes(q) ||
                          (p.account?.platform?.display_name || '').toLowerCase().includes(q)
                        );
                      })
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
              {(selectedPayment.company_screenshot_url || selectedPayment.payment_screenshot_url || selectedPayment.screenshot_url) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(selectedPayment.company_screenshot_url || selectedPayment.screenshot_url) && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" /> Company Payment</p>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openImageInNewTab((selectedPayment.company_screenshot_url || selectedPayment.screenshot_url) as string)}>
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </div>
                      <img src={(selectedPayment.company_screenshot_url || selectedPayment.screenshot_url) as string} alt="Company" className="w-full rounded-lg border" />
                    </div>
                  )}
                  {selectedPayment.payment_screenshot_url && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Send className="h-3 w-3" /> Payment Sent</p>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openImageInNewTab(selectedPayment.payment_screenshot_url as string)}>
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </div>
                      <img src={selectedPayment.payment_screenshot_url} alt="Payment" className="w-full rounded-lg border" />
                    </div>
                  )}
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
    </div>
  );
}
