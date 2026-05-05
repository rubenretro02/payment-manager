'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ImageIcon,
  RefreshCw,
  DollarSign,
  Calendar,
  TrendingUp,
  Eye,
  ExternalLink,
  AlertTriangle,
  X,
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
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

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

  // Filter payments by status
  const filteredPayments = statusFilter
    ? payments.filter(p => p.status === statusFilter)
    : payments;

  // Stats
  const stats = {
    totalEarned: payments
      .filter(p => p.status === 'confirmed')
      .reduce((sum, p) => sum + (p.platform_amount || 0), 0),
    totalPaid: payments
      .filter(p => p.status === 'confirmed')
      .reduce((sum, p) => sum + (p.amount_paid || 0), 0),
    pending: payments.filter(p => p.status === 'submitted' || p.status === 'pending').length,
    confirmed: payments.filter(p => p.status === 'confirmed').length,
    rejected: payments.filter(p => p.status === 'rejected').length,
  };

  const openPaymentDetail = (payment: Payment) => {
    setSelectedPayment(payment);
    setIsDetailDialogOpen(true);
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
            Your payment history and earnings
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
        <Card className="col-span-2">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Total Earned</p>
                <p className="text-xl font-bold text-blue-600">${stats.totalEarned.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">From companies</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Paid</p>
                <p className="text-xl font-bold text-green-600">${stats.totalPaid.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">To admin</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all ${statusFilter === 'confirmed' ? 'ring-2 ring-green-500' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'confirmed' ? null : 'confirmed')}
        >
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Confirmed</p>
                <p className="text-lg font-bold text-green-600">{stats.confirmed}</p>
              </div>
              <CheckCircle2 className="h-6 w-6 text-green-600/20" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all ${statusFilter === 'submitted' ? 'ring-2 ring-blue-500' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'submitted' ? null : 'submitted')}
        >
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-lg font-bold text-blue-600">{stats.pending}</p>
              </div>
              <Clock className="h-6 w-6 text-blue-600/20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Filter */}
      {statusFilter && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Showing:</span>
          <Badge
            variant="outline"
            className={`cursor-pointer ${statusConfig[statusFilter]?.color || ''}`}
            onClick={() => setStatusFilter(null)}
          >
            {statusConfig[statusFilter]?.label || statusFilter}
            <X className="h-3 w-3 ml-1" />
          </Badge>
        </div>
      )}

      {/* Payments List */}
      {filteredPayments.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <DollarSign className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-medium text-lg">
              {statusFilter ? `No ${statusFilter} payments` : 'No payments yet'}
            </h3>
            <p className="text-muted-foreground text-sm">
              {statusFilter ? 'Try a different filter' : 'Your payment history will appear here'}
            </p>
            {statusFilter && (
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setStatusFilter(null)}>
                Clear filter
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredPayments.map((payment) => {
            const config = statusConfig[payment.status] || statusConfig.pending;
            const StatusIcon = config.icon;
            const isNoPaymentReport = payment.platform_amount === 0 && payment.user_notes?.startsWith('NO PAYMENT RECEIVED:');

            return (
              <Card
                key={payment.id}
                className="cursor-pointer hover:border-primary/50 transition-all active:scale-[0.99]"
                onClick={() => openPaymentDetail(payment)}
              >
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

                  {isNoPaymentReport ? (
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mb-2">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="font-medium">No Payment Reported</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 text-sm mb-2">
                      <div>
                        <p className="text-muted-foreground text-xs">Earned</p>
                        <p className="font-medium text-blue-600">${Number(payment.platform_amount || 0).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">You Sent</p>
                        <p className="font-semibold text-green-600">${Number(payment.amount_paid || 0).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Your Keep</p>
                        <p className="font-medium text-primary">
                          ${(Number(payment.platform_amount || 0) - Number(payment.amount_paid || 0)).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {payment.submitted_at
                        ? format(new Date(payment.submitted_at), "MMM d, yyyy", { locale: enUS })
                        : 'Not submitted'}
                    </div>
                    <div className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      <span>Tap for details</span>
                    </div>
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

      {/* Payment Detail Dialog */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payment Details</DialogTitle>
            <DialogDescription>
              {selectedPayment?.account?.platform?.display_name} - {selectedPayment?.account?.full_name}
            </DialogDescription>
          </DialogHeader>

          {selectedPayment && (
            <div className="space-y-4">
              {/* Status */}
              <div className="flex justify-center">
                <Badge className={`${statusConfig[selectedPayment.status]?.color || ''} text-sm px-4 py-1`}>
                  {(() => {
                    const StatusIcon = statusConfig[selectedPayment.status]?.icon || Clock;
                    return <StatusIcon className="h-4 w-4 mr-2" />;
                  })()}
                  {statusConfig[selectedPayment.status]?.label || selectedPayment.status}
                </Badge>
              </div>

              {/* Amount Summary */}
              {selectedPayment.platform_amount !== 0 && (
                <Card className="bg-muted/50">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <p className="text-xs text-muted-foreground">Company Paid You</p>
                        <p className="text-2xl font-bold text-blue-600">
                          ${Number(selectedPayment.platform_amount || 0).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">You Sent ({selectedPayment.percentage_applied}%)</p>
                        <p className="text-2xl font-bold text-green-600">
                          ${Number(selectedPayment.amount_paid || 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t text-center">
                      <p className="text-xs text-muted-foreground">Your Earnings</p>
                      <p className="text-xl font-bold text-primary">
                        ${(Number(selectedPayment.platform_amount || 0) - Number(selectedPayment.amount_paid || 0)).toFixed(2)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* No Payment Report */}
              {selectedPayment.user_notes?.startsWith('NO PAYMENT RECEIVED:') && (
                <Card className="border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-2">
                      <AlertTriangle className="h-5 w-5" />
                      <span className="font-semibold">No Payment Received</span>
                    </div>
                    <p className="text-sm text-red-800 dark:text-red-300">
                      {selectedPayment.user_notes.replace('NO PAYMENT RECEIVED: ', '')}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Details */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Method</span>
                  <span className="font-medium">{selectedPayment.payment_method || 'N/A'}</span>
                </div>
                {selectedPayment.payment_reference && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Reference</span>
                    <span className="font-medium">{selectedPayment.payment_reference}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Submitted</span>
                  <span className="font-medium">
                    {selectedPayment.submitted_at
                      ? format(new Date(selectedPayment.submitted_at), "MMM d, yyyy 'at' h:mm a", { locale: enUS })
                      : 'Not submitted'}
                  </span>
                </div>
                {selectedPayment.confirmed_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Confirmed</span>
                    <span className="font-medium text-green-600">
                      {format(new Date(selectedPayment.confirmed_at), "MMM d, yyyy 'at' h:mm a", { locale: enUS })}
                    </span>
                  </div>
                )}
              </div>

              {/* Screenshots */}
              {(selectedPayment.company_screenshot_url || selectedPayment.payment_screenshot_url) && (
                <div className="space-y-2">
                  <p className="font-medium text-sm">Screenshots</p>
                  <Tabs defaultValue="company" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="company" disabled={!selectedPayment.company_screenshot_url}>
                        Company Payment
                      </TabsTrigger>
                      <TabsTrigger value="sent" disabled={!selectedPayment.payment_screenshot_url}>
                        Payment Sent
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="company" className="mt-2">
                      {selectedPayment.company_screenshot_url && (
                        <div className="relative">
                          <img
                            src={selectedPayment.company_screenshot_url}
                            alt="Company payment screenshot"
                            className="w-full rounded-lg border"
                          />
                          {!selectedPayment.company_screenshot_url.startsWith('data:') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="absolute top-2 right-2"
                              onClick={() => window.open(selectedPayment.company_screenshot_url!, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="sent" className="mt-2">
                      {selectedPayment.payment_screenshot_url && (
                        <div className="relative">
                          <img
                            src={selectedPayment.payment_screenshot_url}
                            alt="Payment sent screenshot"
                            className="w-full rounded-lg border"
                          />
                          {!selectedPayment.payment_screenshot_url.startsWith('data:') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="absolute top-2 right-2"
                              onClick={() => window.open(selectedPayment.payment_screenshot_url!, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              )}

              {/* Notes */}
              {selectedPayment.user_notes && !selectedPayment.user_notes.startsWith('NO PAYMENT RECEIVED:') && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Your Notes</p>
                  <p className="text-sm bg-muted p-2 rounded">{selectedPayment.user_notes}</p>
                </div>
              )}

              {/* Admin Notes */}
              {selectedPayment.admin_notes && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Admin Notes</p>
                  <p className="text-sm bg-muted p-2 rounded">{selectedPayment.admin_notes}</p>
                </div>
              )}

              {/* Rejection Reason */}
              {selectedPayment.status === 'rejected' && selectedPayment.rejection_reason && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">Rejection Reason</p>
                  <p className="text-sm text-red-700 dark:text-red-400">{selectedPayment.rejection_reason}</p>
                </div>
              )}

              <Button className="w-full" onClick={() => setIsDetailDialogOpen(false)}>
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
