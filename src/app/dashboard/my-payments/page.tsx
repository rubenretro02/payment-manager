'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ImageIcon,
  RefreshCw,
  DollarSign,
  Calendar,
} from 'lucide-react';
import { format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import type { Payment } from '@/lib/types';

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', icon: ImageIcon },
  confirmed: { label: 'Confirmed', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
};

export default function MyPaymentsPage() {
  const { user } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchPayments(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    try {
      const response = await fetch(`/api/my-payments?user_id=${user?.id}`);
      const data = await response.json();
      if (data.success) {
        setPayments(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching payments:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (user?.id) {
      fetchPayments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleRefresh = () => {
    fetchPayments(true);
  };

  const stats = {
    total: payments.length,
    submitted: payments.filter(p => p.status === 'submitted').length,
    confirmed: payments.filter(p => p.status === 'confirmed').length,
    rejected: payments.filter(p => p.status === 'rejected').length,
    totalPaid: payments
      .filter(p => p.status === 'confirmed')
      .reduce((sum, p) => sum + (p.amount_paid || 0), 0),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in pb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">My Payments</h1>
          <p className="text-sm text-muted-foreground">
            Your payment history
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
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Paid</p>
                <p className="text-lg font-bold text-green-600">${stats.totalPaid.toFixed(2)}</p>
              </div>
              <DollarSign className="h-6 w-6 text-green-600/20" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Confirmed</p>
                <p className="text-lg font-bold">{stats.confirmed}</p>
              </div>
              <CheckCircle2 className="h-6 w-6 text-green-600/20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payments List */}
      {payments.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <DollarSign className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-medium text-lg">No payments yet</h3>
            <p className="text-muted-foreground text-sm">
              Your payment history will appear here
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {payments.map((payment) => {
            const config = statusConfig[payment.status] || statusConfig.pending;
            const StatusIcon = config.icon;

            return (
              <Card key={payment.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium">
                        {payment.account?.platform?.display_name || 'Payment'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {payment.account?.full_name}
                      </p>
                    </div>
                    <Badge className={config.color}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {config.label}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                    <div>
                      <p className="text-muted-foreground text-xs">Company Paid</p>
                      <p className="font-medium">${Number(payment.platform_amount || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">You Sent</p>
                      <p className="font-semibold text-primary">${Number(payment.amount_paid || 0).toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {payment.submitted_at
                        ? format(new Date(payment.submitted_at), "MMM d, yyyy", { locale: enUS })
                        : 'Not submitted'}
                    </div>
                    <span>{payment.percentage_applied}%</span>
                  </div>

                  {payment.status === 'rejected' && payment.rejection_reason && (
                    <div className="mt-2 p-2 rounded bg-red-50 dark:bg-red-900/20 text-xs text-red-800 dark:text-red-300">
                      <strong>Reason:</strong> {payment.rejection_reason}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
