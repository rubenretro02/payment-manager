'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Search,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  ImageIcon,
  CreditCard,
  Loader2,
  Building2,
  Send,
  ExternalLink,
} from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import type { Payment } from '@/lib/types';

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  submitted: { label: 'To Confirm', color: 'bg-blue-100 text-blue-800', icon: ImageIcon },
  confirmed: { label: 'Confirmed', color: 'bg-green-100 text-green-800', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800', icon: XCircle },
};

export default function PaymentsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const statusFromUrl = searchParams.get('status');
  const paymentIdFromUrl = searchParams.get('payment');

  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTab, setSelectedTab] = useState(statusFromUrl || 'submitted');
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const [screenshotTab, setScreenshotTab] = useState<'company' | 'payment'>('company');
  const [confirmAction, setConfirmAction] = useState<'confirm' | 'reject' | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAdmin = user?.role === 'admin';

  // Update tab when URL changes
  useEffect(() => {
    if (statusFromUrl) {
      setSelectedTab(statusFromUrl);
    }
  }, [statusFromUrl]);

  useEffect(() => {
    fetchPayments();
  }, []);

  // Open payment from URL parameter (deep link from notifications)
  useEffect(() => {
    if (paymentIdFromUrl && payments.length > 0) {
      const payment = payments.find(p => p.id === paymentIdFromUrl);
      if (payment) {
        setSelectedPayment(payment);
        setShowDetails(true);
        // Switch to the appropriate tab
        setSelectedTab(payment.status === 'submitted' ? 'submitted' : 'all');
      }
    }
  }, [paymentIdFromUrl, payments]);

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

  const filteredPayments = payments.filter((payment) => {
    const matchesSearch =
      payment.user?.telegram_first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      payment.user?.telegram_username?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = selectedTab === 'all' || payment.status === selectedTab;
    return matchesSearch && matchesTab;
  });

  const getInitials = (name: string | null | undefined) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const stats = {
    pending: payments.filter(p => p.status === 'pending').length,
    submitted: payments.filter(p => p.status === 'submitted').length,
    confirmed: payments.filter(p => p.status === 'confirmed').length,
    rejected: payments.filter(p => p.status === 'rejected').length,
  };

  // Check if payment has any screenshots
  const hasScreenshots = (payment: Payment) => {
    return payment.company_screenshot_url || payment.payment_screenshot_url || payment.screenshot_url;
  };

  // Get the appropriate screenshot URL
  const getCompanyScreenshot = (payment: Payment) => {
    return payment.company_screenshot_url || payment.screenshot_url;
  };

  const getPaymentScreenshot = (payment: Payment) => {
    return payment.payment_screenshot_url || payment.screenshot_url;
  };

  const handleConfirm = async () => {
    if (!selectedPayment || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/payments/${selectedPayment.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_notes: adminNotes }),
      });
      const data = await response.json();
      if (data.success) {
        await fetchPayments();
        setConfirmAction(null);
        setSelectedPayment(null);
        setAdminNotes('');
      } else {
        alert('Error: ' + (data.error || 'Failed to confirm payment'));
      }
    } catch (error) {
      console.error('Error confirming payment:', error);
      alert('Error confirming payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!selectedPayment || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/payments/${selectedPayment.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejection_reason: rejectionReason }),
      });
      const data = await response.json();
      if (data.success) {
        // Offer to send WhatsApp explaining the rejection (only if user has phone)
        const userPhone = selectedPayment.user?.phone;
        if (userPhone) {
          const wantsWhatsApp = confirm(
            `Payment rejected. Send WhatsApp to ${selectedPayment.user?.telegram_first_name || 'user'} explaining the reason?`
          );
          if (wantsWhatsApp) {
            const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://reportpayment.blackgoatt.com';
            const accountName = selectedPayment.account?.full_name || 'your account';
            const platform = selectedPayment.account?.platform?.display_name || '';
            const message =
              `Hi ${selectedPayment.user?.telegram_first_name || ''},\n\n` +
              `❌ Your payment was rejected:\n\n` +
              `📋 Account: ${accountName}\n` +
              (platform ? `🏢 Platform: ${platform}\n` : '') +
              `💰 Amount: $${Number(selectedPayment.amount_paid || 0).toFixed(2)}\n\n` +
              `📝 Reason: ${rejectionReason}\n\n` +
              `Please review and resubmit the payment:\n${appUrl}`;
            const cleanPhone = userPhone.replace(/\D/g, '');
            window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
          }
        }

        await fetchPayments();
        setConfirmAction(null);
        setSelectedPayment(null);
        setRejectionReason('');
      } else {
        alert('Error: ' + (data.error || 'Failed to reject payment'));
      }
    } catch (error) {
      console.error('Error rejecting payment:', error);
      alert('Error rejecting payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open image in new tab - handles both URLs and base64 data
  const openInNewTab = (url: string) => {
    if (!url) return;

    // If it's a base64 image, open it in a new window with proper HTML
    if (url.startsWith('data:')) {
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Payment Screenshot</title>
              <style>
                body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #1a1a1a; }
                img { max-width: 100%; max-height: 100vh; object-fit: contain; }
              </style>
            </head>
            <body>
              <img src="${url}" alt="Screenshot" />
            </body>
          </html>
        `);
        newWindow.document.close();
      }
    } else {
      // Regular URL - open directly
      window.open(url, '_blank');
    }
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
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="text-muted-foreground">
            Manage and confirm user payments
          </p>
        </div>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="cursor-pointer transition-colors hover:border-yellow-500" onClick={() => setSelectedTab('pending')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-600/20" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer transition-colors hover:border-blue-500" onClick={() => setSelectedTab('submitted')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">To Confirm</p>
                <p className="text-2xl font-bold text-blue-600">{stats.submitted}</p>
              </div>
              <ImageIcon className="h-8 w-8 text-blue-600/20" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer transition-colors hover:border-green-500" onClick={() => setSelectedTab('confirmed')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Confirmed</p>
                <p className="text-2xl font-bold text-green-600">{stats.confirmed}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-600/20" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer transition-colors hover:border-red-500" onClick={() => setSelectedTab('rejected')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Rejected</p>
                <p className="text-2xl font-bold text-red-600">{stats.rejected}</p>
              </div>
              <XCircle className="h-8 w-8 text-red-600/20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by user..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="submitted">To Confirm</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="confirmed">Confirmed</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Payments List */}
      <Card>
        <CardContent className="p-0">
          {filteredPayments.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">No payments registered</p>
              <p className="text-sm">Payments will appear here when users submit them</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="divide-y">
                {filteredPayments.map((payment) => {
                  const config = statusConfig[payment.status] || statusConfig.pending;
                  return (
                    <div
                      key={payment.id}
                      className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        setSelectedPayment(payment);
                        setShowDetails(true);
                      }}
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {getInitials(payment.user?.telegram_first_name)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">
                            {payment.user?.telegram_first_name || 'User'}
                          </p>
                          <Badge variant="outline" className="shrink-0">
                            {payment.account?.platform?.display_name || 'Platform'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>@{payment.user?.telegram_username || 'user'}</span>
                          {payment.submitted_at && (
                            <>
                              <span>•</span>
                              <span>{format(new Date(payment.submitted_at), "MMM d, HH:mm")}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="text-right hidden sm:block">
                        <p className="text-sm text-muted-foreground">Platform earnings</p>
                        <p className="font-medium">${Number(payment.platform_amount || 0).toFixed(2)}</p>
                      </div>

                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Owes ({payment.percentage_applied}%)</p>
                        <p className="font-semibold text-lg">${Number(payment.amount_owed).toFixed(2)}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        {hasScreenshots(payment) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPayment(payment);
                              setShowScreenshot(true);
                            }}
                          >
                            <ImageIcon className="h-4 w-4" />
                          </Button>
                        )}
                        <Badge className={config.color}>
                          {config.label}
                        </Badge>
                      </div>

                      {isAdmin && payment.status === 'submitted' && (
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPayment(payment);
                              setConfirmAction('confirm');
                            }}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPayment(payment);
                              setConfirmAction('reject');
                            }}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Screenshots Dialog - Updated for dual screenshots */}
      <Dialog open={showScreenshot && selectedPayment !== null} onOpenChange={setShowScreenshot}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Payment Screenshots</DialogTitle>
            <DialogDescription>
              {selectedPayment?.user?.telegram_first_name} - ${Number(selectedPayment?.amount_owed || 0).toFixed(2)}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={screenshotTab} onValueChange={(v) => setScreenshotTab(v as 'company' | 'payment')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="company" className="gap-2">
                <Building2 className="h-4 w-4" />
                Company Payment
              </TabsTrigger>
              <TabsTrigger value="payment" className="gap-2">
                <Send className="h-4 w-4" />
                Payment Sent
              </TabsTrigger>
            </TabsList>

            <TabsContent value="company" className="mt-4">
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
                {selectedPayment && getCompanyScreenshot(selectedPayment) ? (
                  <>
                    <img
                      src={getCompanyScreenshot(selectedPayment) || ''}
                      alt="Company Payment Receipt"
                      className="h-full w-full object-contain"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="absolute top-2 right-2 gap-1"
                      onClick={() => {
                        const url = getCompanyScreenshot(selectedPayment);
                        if (url) openInNewTab(url);
                      }}
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </Button>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No company payment screenshot</p>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-2 text-center">
                Screenshot of what the company paid the user
              </p>
            </TabsContent>

            <TabsContent value="payment" className="mt-4">
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
                {selectedPayment && getPaymentScreenshot(selectedPayment) ? (
                  <>
                    <img
                      src={getPaymentScreenshot(selectedPayment) || ''}
                      alt="Payment Sent Receipt"
                      className="h-full w-full object-contain"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="absolute top-2 right-2 gap-1"
                      onClick={() => {
                        const url = getPaymentScreenshot(selectedPayment);
                        if (url) openInNewTab(url);
                      }}
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </Button>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No payment sent screenshot</p>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-2 text-center">
                Screenshot of the payment the user sent to you
              </p>
            </TabsContent>
          </Tabs>

          {/* Payment details summary */}
          <div className="rounded-lg bg-muted p-4 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Platform</p>
                <p className="font-medium">{selectedPayment?.account?.platform?.display_name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Company Paid</p>
                <p className="font-medium">${Number(selectedPayment?.platform_amount || 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Percentage</p>
                <p className="font-medium">{selectedPayment?.percentage_applied}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Amount Sent</p>
                <p className="font-semibold text-primary">${Number(selectedPayment?.amount_paid || 0).toFixed(2)}</p>
              </div>
            </div>
          </div>

          {isAdmin && selectedPayment?.status === 'submitted' && (
            <DialogFooter>
              <Button
                variant="outline"
                className="text-red-600"
                onClick={() => {
                  setShowScreenshot(false);
                  setConfirmAction('reject');
                }}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Reject
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => {
                  setShowScreenshot(false);
                  setConfirmAction('confirm');
                }}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Confirm Payment
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm Dialog */}
      <Dialog open={confirmAction === 'confirm'} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Payment</DialogTitle>
            <DialogDescription>
              Confirm ${Number(selectedPayment?.amount_owed || 0).toFixed(2)} payment from {selectedPayment?.user?.telegram_first_name}?
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="rounded-lg bg-muted p-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Platform:</span>
                <span>{selectedPayment?.account?.platform?.display_name}</span>
                <span className="text-muted-foreground">Amount earned:</span>
                <span>${Number(selectedPayment?.platform_amount || 0).toFixed(2)}</span>
                <span className="text-muted-foreground">Percentage:</span>
                <span>{selectedPayment?.percentage_applied}%</span>
                <span className="text-muted-foreground">Amount owed:</span>
                <span className="font-semibold">${Number(selectedPayment?.amount_owed || 0).toFixed(2)}</span>
                <span className="text-muted-foreground">Amount sent:</span>
                <span className="font-semibold text-primary">${Number(selectedPayment?.amount_paid || 0).toFixed(2)}</span>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Add note..."
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleConfirm} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Confirming...
                </>
              ) : (
                'Confirm Payment'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={confirmAction === 'reject'} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Payment</DialogTitle>
            <DialogDescription>
              The user will be notified of the rejection.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Rejection reason *</Label>
              <Textarea
                placeholder="e.g., Amount doesn't match the receipt..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectionReason.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rejecting...
                </>
              ) : (
                'Reject Payment'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Details Dialog */}
      <Dialog open={showDetails && selectedPayment !== null} onOpenChange={setShowDetails}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment Details</DialogTitle>
            <DialogDescription>
              {selectedPayment?.user?.telegram_first_name || 'User'} - {selectedPayment?.account?.platform?.display_name || 'Platform'}
            </DialogDescription>
          </DialogHeader>

          {selectedPayment && (
            <div className="space-y-4">
              {/* Status Badge */}
              <div className="flex justify-center">
                <Badge className={`text-sm px-4 py-1 ${
                  selectedPayment.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                  selectedPayment.status === 'rejected' ? 'bg-red-100 text-red-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {selectedPayment.status === 'submitted' ? 'To Confirm' : selectedPayment.status}
                </Badge>
              </div>

              {/* Payment Info Grid */}
              <div className="grid gap-3">
                <div className="rounded-lg bg-muted p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Date</span>
                    <span className="font-medium">
                      {format(new Date(selectedPayment.created_at), "MMMM d, yyyy 'at' HH:mm")}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Platform Earnings</span>
                    <span className="font-medium">${Number(selectedPayment.platform_amount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Percentage</span>
                    <span className="font-medium">{selectedPayment.percentage_applied}%</span>
                  </div>
                </div>

                <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Should Pay</span>
                    <span className="font-bold text-lg">${Number(selectedPayment.amount_owed || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Actually Sent</span>
                    <span className="font-bold text-lg text-primary">${Number(selectedPayment.amount_paid || 0).toFixed(2)}</span>
                  </div>
                  {Number(selectedPayment.amount_owed) !== Number(selectedPayment.amount_paid) && (
                    <div className="flex justify-between items-center pt-2 border-t">
                      <span className="text-muted-foreground">Difference</span>
                      <span className={`font-bold ${
                        Number(selectedPayment.amount_paid) >= Number(selectedPayment.amount_owed)
                          ? 'text-green-600'
                          : 'text-red-600'
                      }`}>
                        {Number(selectedPayment.amount_paid) >= Number(selectedPayment.amount_owed) ? '+' : '-'}
                        ${Math.abs(Number(selectedPayment.amount_paid || 0) - Number(selectedPayment.amount_owed || 0)).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Payment Method & Reference */}
                {(selectedPayment.payment_method || selectedPayment.payment_reference) && (
                  <div className="rounded-lg bg-muted p-4 space-y-2">
                    {selectedPayment.payment_method && (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Payment Method</span>
                        <span className="font-medium capitalize">{selectedPayment.payment_method}</span>
                      </div>
                    )}
                    {selectedPayment.payment_reference && (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Reference</span>
                        <span className="font-mono text-sm">{selectedPayment.payment_reference}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* User Notes */}
                {selectedPayment.user_notes && (
                  <div className="rounded-lg bg-muted p-4">
                    <p className="text-sm text-muted-foreground mb-1">User Notes:</p>
                    <p className="text-sm">{selectedPayment.user_notes}</p>
                  </div>
                )}

                {/* Rejection Reason */}
                {selectedPayment.status === 'rejected' && selectedPayment.rejection_reason && (
                  <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
                    <p className="text-sm text-red-800 dark:text-red-300 font-medium mb-1">Rejection Reason:</p>
                    <p className="text-sm text-red-700 dark:text-red-400">{selectedPayment.rejection_reason}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {selectedPayment && hasScreenshots(selectedPayment) && (
              <Button
                variant="outline"
                onClick={() => {
                  setShowDetails(false);
                  setShowScreenshot(true);
                }}
                className="gap-2"
              >
                <ImageIcon className="h-4 w-4" />
                View Screenshots
              </Button>
            )}
            {isAdmin && selectedPayment?.status === 'submitted' && (
              <>
                <Button
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => {
                    setShowDetails(false);
                    setConfirmAction('reject');
                  }}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => {
                    setShowDetails(false);
                    setConfirmAction('confirm');
                  }}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Confirm
                </Button>
              </>
            )}
            {(!isAdmin || selectedPayment?.status !== 'submitted') && (
              <Button onClick={() => setShowDetails(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
