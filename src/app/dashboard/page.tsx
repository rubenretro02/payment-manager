'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/hooks/useAuth';
import {
  Users,
  CreditCard,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ImageIcon,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import type { Payment } from '@/lib/types';

interface Stats {
  totalUsers: number;
  totalIBOs: number;
  pendingPayments: number;
  totalOwed: number;
  totalPaid: number;
  collectionRate: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, paymentsRes] = await Promise.all([
          fetch('/api/stats'),
          fetch('/api/payments?status=submitted'),
        ]);

        const statsData = await statsRes.json();
        const paymentsData = await paymentsRes.json();

        if (statsData.success) setStats(statsData.data);
        if (paymentsData.success) setPayments(paymentsData.data || []);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const isAdmin = user?.role === 'admin';
  const isIBO = user?.role === 'ibo';

  const getInitials = (name: string | null | undefined) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
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
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold">
          Hello, {user?.telegram_first_name || user?.email?.split('@')[0] || 'User'}!
        </h1>
        <p className="text-muted-foreground">
          {isAdmin ? "Here's your business overview" : isIBO ? "Here's your team overview" : "Here's your overview"}
        </p>
      </div>

      {/* Stats Grid - Clickable Cards */}
      {(isAdmin || isIBO) && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card
            className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md active:scale-[0.98]"
            onClick={() => router.push('/dashboard/users')}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Users
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalUsers || 0}</div>
              <p className="text-xs text-muted-foreground">
                {stats?.totalIBOs || 0} IBOs
              </p>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-all hover:border-yellow-500/50 hover:shadow-md active:scale-[0.98]"
            onClick={() => router.push('/dashboard/payments')}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pending Payments
              </CardTitle>
              <Clock className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">
                {stats?.pendingPayments || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                Click to confirm →
              </p>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md active:scale-[0.98]"
            onClick={() => router.push('/dashboard/payments')}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Amount Owed
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${(stats?.totalOwed || 0).toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                Pending
              </p>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-all hover:border-green-500/50 hover:shadow-md active:scale-[0.98]"
            onClick={() => router.push('/dashboard/payments')}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Collection Rate
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {stats?.collectionRate || 0}%
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-green-600 transition-all"
                  style={{ width: `${stats?.collectionRate || 0}%` }}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Payments to Confirm */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Payments to Confirm</CardTitle>
              <CardDescription>
                {payments.length > 0
                  ? `${payments.length} payments awaiting your confirmation`
                  : 'No pending payments'}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => window.location.href = '/dashboard/payments'}>
              View all
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No payments pending confirmation</p>
              <p className="text-sm">When users submit payments, they will appear here</p>
            </div>
          ) : (
            <div className="space-y-4">
              {payments.slice(0, 5).map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {getInitials(payment.user?.telegram_first_name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">
                        {payment.account?.full_name || 'Account'}
                      </p>
                      <Badge variant="outline" className="shrink-0">
                        {payment.account?.platform?.display_name || 'Platform'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                      <span className="font-medium text-foreground/80">
                        {payment.user?.telegram_first_name || 'User'}
                      </span>
                      {payment.user?.telegram_username && (
                        <span>@{payment.user.telegram_username}</span>
                      )}
                      {payment.submitted_at && (
                        <>
                          <span>•</span>
                          <span>{format(new Date(payment.submitted_at), "MMM d, HH:mm")}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="font-semibold">${Number(payment.amount_owed).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">
                      {payment.percentage_applied}% of ${Number(payment.platform_amount || 0).toFixed(2)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {payment.screenshot_url && (
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ImageIcon className="h-4 w-4" />
                      </Button>
                    )}
                    <Badge className="bg-blue-100 text-blue-800">
                      To Confirm
                    </Badge>
                  </div>

                  {isAdmin && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-100">
                        <CheckCircle2 className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-100">
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
