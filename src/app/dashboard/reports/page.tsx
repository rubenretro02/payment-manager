'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
} from 'lucide-react';
import { format, subDays, subWeeks, subMonths, subYears, startOfDay, startOfWeek, startOfMonth, startOfYear, isAfter } from 'date-fns';
import type { Payment } from '@/lib/types';

type DateRange = 'today' | 'week' | 'month' | 'year' | 'all';

export default function ReportsPage() {
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState((new Date().getMonth() + 1).toString());

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

  // Filter payments by date range
  const getFilteredPayments = () => {
    const now = new Date();
    let startDate: Date;

    switch (dateRange) {
      case 'today':
        startDate = startOfDay(now);
        break;
      case 'week':
        startDate = startOfWeek(now, { weekStartsOn: 1 });
        break;
      case 'month':
        startDate = startOfMonth(now);
        break;
      case 'year':
        startDate = startOfYear(now);
        break;
      case 'all':
      default:
        return payments;
    }

    return payments.filter(p => {
      const paymentDate = new Date(p.created_at);
      return isAfter(paymentDate, startDate);
    });
  };

  // Filter by specific month/year
  const getMonthlyPayments = () => {
    return payments.filter(p => {
      const paymentDate = new Date(p.created_at);
      return (
        paymentDate.getFullYear() === parseInt(selectedYear) &&
        paymentDate.getMonth() + 1 === parseInt(selectedMonth)
      );
    });
  };

  const filteredPayments = dateRange === 'all' ? getMonthlyPayments() : getFilteredPayments();

  // Calculate stats
  const stats = {
    totalPlatformEarnings: filteredPayments.reduce((sum, p) => sum + (Number(p.platform_amount) || 0), 0),
    totalOwed: filteredPayments.reduce((sum, p) => sum + (Number(p.amount_owed) || 0), 0),
    totalReceived: filteredPayments
      .filter(p => p.status === 'confirmed')
      .reduce((sum, p) => sum + (Number(p.amount_paid) || 0), 0),
    totalPending: filteredPayments
      .filter(p => p.status === 'submitted' || p.status === 'pending')
      .reduce((sum, p) => sum + (Number(p.amount_owed) || 0), 0),
    totalRejected: filteredPayments
      .filter(p => p.status === 'rejected')
      .reduce((sum, p) => sum + (Number(p.amount_owed) || 0), 0),
    // Loss = what they should have paid - what they actually paid
    totalLoss: filteredPayments
      .filter(p => p.status === 'confirmed')
      .reduce((sum, p) => {
        const owed = Number(p.amount_owed) || 0;
        const paid = Number(p.amount_paid) || 0;
        return sum + Math.max(0, owed - paid);
      }, 0),
    paymentsCount: {
      total: filteredPayments.length,
      confirmed: filteredPayments.filter(p => p.status === 'confirmed').length,
      pending: filteredPayments.filter(p => p.status === 'submitted' || p.status === 'pending').length,
      rejected: filteredPayments.filter(p => p.status === 'rejected').length,
    },
  };

  const collectionRate = stats.totalOwed > 0
    ? ((stats.totalReceived / stats.totalOwed) * 100).toFixed(1)
    : '0';

  // Get available years from payments
  const availableYears = [...new Set(payments.map(p => new Date(p.created_at).getFullYear()))].sort((a, b) => b - a);
  if (availableYears.length === 0) availableYears.push(new Date().getFullYear());

  const months = [
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
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
            Income summary and payment analytics
          </p>
        </div>
        <Button variant="outline" className="gap-2">
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
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-[100px]">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableYears.map(y => (
                      <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card
          className="border-green-200 dark:border-green-800 cursor-pointer transition-all hover:shadow-md hover:border-green-400 active:scale-[0.98]"
          onClick={() => router.push('/dashboard/payments?status=confirmed')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Total Received
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${stats.totalReceived.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              From {stats.paymentsCount.confirmed} confirmed payments →
            </p>
          </CardContent>
        </Card>

        <Card
          className="border-yellow-200 dark:border-yellow-800 cursor-pointer transition-all hover:shadow-md hover:border-yellow-400 active:scale-[0.98]"
          onClick={() => router.push('/dashboard/payments?status=submitted')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-600" />
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              ${stats.totalPending.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.paymentsCount.pending} payments awaiting →
            </p>
          </CardContent>
        </Card>

        <Card
          className="border-red-200 dark:border-red-800 cursor-pointer transition-all hover:shadow-md hover:border-red-400 active:scale-[0.98]"
          onClick={() => router.push('/dashboard/payments')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-600" />
              Losses (Underpaid)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              ${stats.totalLoss.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              Difference between owed & paid →
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-all hover:shadow-md hover:border-primary/50 active:scale-[0.98]"
          onClick={() => router.push('/dashboard/payments')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <PieChart className="h-4 w-4" />
              Collection Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {collectionRate}%
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-green-600 transition-all"
                style={{ width: `${Math.min(100, Number(collectionRate))}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stats */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Income Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Income Breakdown</CardTitle>
            <CardDescription>Summary of platform earnings and your share</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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

        {/* Payment Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Payment Status</CardTitle>
            <CardDescription>Breakdown by status - click to filter</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all hover:bg-green-50 hover:border-green-300 dark:hover:bg-green-900/20 active:scale-[0.98]"
              onClick={() => router.push('/dashboard/payments?status=confirmed')}
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span>Confirmed</span>
              </div>
              <div className="text-right">
                <Badge className="bg-green-100 text-green-800">{stats.paymentsCount.confirmed}</Badge>
              </div>
            </div>
            <div
              className="flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all hover:bg-yellow-50 hover:border-yellow-300 dark:hover:bg-yellow-900/20 active:scale-[0.98]"
              onClick={() => router.push('/dashboard/payments?status=submitted')}
            >
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-yellow-600" />
                <span>Pending / To Confirm</span>
              </div>
              <div className="text-right">
                <Badge className="bg-yellow-100 text-yellow-800">{stats.paymentsCount.pending}</Badge>
              </div>
            </div>
            <div
              className="flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all hover:bg-red-50 hover:border-red-300 dark:hover:bg-red-900/20 active:scale-[0.98]"
              onClick={() => router.push('/dashboard/payments?status=rejected')}
            >
              <div className="flex items-center gap-3">
                <XCircle className="h-5 w-5 text-red-600" />
                <span>Rejected</span>
              </div>
              <div className="text-right">
                <Badge className="bg-red-100 text-red-800">{stats.paymentsCount.rejected}</Badge>
              </div>
            </div>
            <div
              className="flex items-center justify-between p-3 rounded-lg bg-muted cursor-pointer transition-all hover:bg-muted/80 active:scale-[0.98]"
              onClick={() => router.push('/dashboard/payments?status=all')}
            >
              <span className="font-medium">Total Payments</span>
              <span className="font-bold">{stats.paymentsCount.total} →</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payments with Losses (Underpaid) */}
      {stats.totalLoss > 0 && (
        <Card className="border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Underpaid Payments
            </CardTitle>
            <CardDescription>
              Payments where users paid less than owed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Platform Earned</TableHead>
                  <TableHead className="text-right">Should Pay</TableHead>
                  <TableHead className="text-right">Actually Paid</TableHead>
                  <TableHead className="text-right">Loss</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments
                  .filter(p => p.status === 'confirmed' && (Number(p.amount_owed) || 0) > (Number(p.amount_paid) || 0))
                  .map(payment => {
                    const owed = Number(payment.amount_owed) || 0;
                    const paid = Number(payment.amount_paid) || 0;
                    const loss = owed - paid;
                    return (
                      <TableRow key={payment.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{payment.user?.telegram_first_name || 'User'}</p>
                            <p className="text-xs text-muted-foreground">@{payment.user?.telegram_username}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {format(new Date(payment.created_at), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Number(payment.platform_amount || 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          ${owed.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          ${paid.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-red-600 font-medium">
                          -${loss.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Recent Payments Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Payments</CardTitle>
          <CardDescription>
            {filteredPayments.length} payments in selected period
          </CardDescription>
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
                  <TableHead>User</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Platform Earned</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.map(payment => (
                  <TableRow key={payment.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{payment.user?.telegram_first_name || 'User'}</p>
                        <p className="text-xs text-muted-foreground">@{payment.user?.telegram_username}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {payment.account?.platform?.display_name || '-'}
                    </TableCell>
                    <TableCell>
                      {format(new Date(payment.created_at), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(payment.platform_amount || 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(payment.amount_owed || 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${Number(payment.amount_paid || 0).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge className={
                        payment.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                        payment.status === 'rejected' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }>
                        {payment.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
