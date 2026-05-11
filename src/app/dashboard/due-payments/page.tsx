'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle,
  Clock,
  CalendarClock,
  CalendarCheck,
  CheckCircle2,
  Send,
  Loader2,
  Bell,
  Search,
  RefreshCw,
  DollarSign,
  MessageCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

interface DueAccountInfo {
  account_id: string;
  account_name: string;
  account_email: string;
  user_id: string | null;
  user_name: string | null;
  user_username: string | null;
  user_telegram_id: number | null;
  user_phone: string | null;
  platform_name: string;
  project_name: string | null;
  percentage: number;
  payment_frequency: 'weekly' | 'biweekly' | 'monthly';
  next_payment_date: string;
  days_until_due: number;
  status: 'overdue' | 'due_today' | 'due_soon' | 'upcoming' | 'reported' | 'confirmed';
  current_payment_id: string | null;
  current_payment_status: string | null;
  amount_owed: number | null;
}

interface DuePaymentsData {
  overdue: DueAccountInfo[];
  dueToday: DueAccountInfo[];
  dueSoon: DueAccountInfo[];
  upcoming: DueAccountInfo[];
  reported: DueAccountInfo[];
  confirmed: DueAccountInfo[];
  all: DueAccountInfo[];
  summary: {
    overdue: number;
    dueToday: number;
    dueSoon: number;
    upcoming: number;
    reported: number;
    confirmed: number;
  };
}

interface PaymentMethod {
  id: string;
  type: string;
  display_name: string;
  is_active: boolean;
}

const statusConfig = {
  overdue: { label: 'Overdue', color: 'bg-red-100 text-red-800 border-red-200', icon: AlertTriangle },
  due_today: { label: 'Due Today', color: 'bg-orange-100 text-orange-800 border-orange-200', icon: Clock },
  due_soon: { label: 'Due Soon', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: CalendarClock },
  upcoming: { label: 'Upcoming', color: 'bg-blue-100 text-blue-800 border-blue-200', icon: CalendarCheck },
  reported: { label: 'Reported', color: 'bg-purple-100 text-purple-800 border-purple-200', icon: Send },
  confirmed: { label: 'Confirmed', color: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle2 },
};

export default function DuePaymentsPage() {
  const router = useRouter();
  const { user: adminUser } = useAuth();
  const [data, setData] = useState<DuePaymentsData | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [selectedTab, setSelectedTab] = useState<string>('overdue');
  const [searchQuery, setSearchQuery] = useState('');

  // Report dialog state
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<DueAccountInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reportForm, setReportForm] = useState({
    platform_amount: '',
    amount_paid: '',
    payment_method: '',
    payment_reference: '',
    notes: '',
    auto_confirm: true,
  });

  async function fetchData(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    try {
      const [dueRes, methodsRes] = await Promise.all([
        fetch('/api/payments/due'),
        fetch('/api/payment-methods'),
      ]);
      const dueJson = await dueRes.json();
      const methodsJson = await methodsRes.json();
      if (dueJson.success) setData(dueJson.data);
      if (methodsJson.success) {
        setPaymentMethods((methodsJson.data || []).filter((m: PaymentMethod) => m.is_active));
      }
    } catch (error) {
      console.error('Error fetching due payments:', error);
      toast.error('Failed to load due payments');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  const sendReminders = async () => {
    setSendingReminders(true);
    try {
      const res = await fetch('/api/notifications/reminders', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        toast.success(json.data.message || 'Reminders sent');
      } else {
        toast.error(json.error || 'Failed to send reminders');
      }
    } catch (error) {
      toast.error('Failed to send reminders');
    } finally {
      setSendingReminders(false);
    }
  };

  const openReportDialog = (item: DueAccountInfo) => {
    setSelectedItem(item);
    setReportForm({
      platform_amount: '',
      amount_paid: '',
      payment_method: paymentMethods[0]?.type || 'other',
      payment_reference: '',
      notes: '',
      auto_confirm: true,
    });
    setReportDialogOpen(true);
  };

  const handleSubmitReport = async () => {
    if (!selectedItem) return;
    if (!reportForm.platform_amount || !reportForm.amount_paid) {
      toast.error('Please enter platform amount and amount paid');
      return;
    }

    setSubmitting(true);
    try {
      const platformAmount = parseFloat(reportForm.platform_amount);
      const amountPaid = parseFloat(reportForm.amount_paid);
      const amountOwed = (platformAmount * selectedItem.percentage) / 100;

      const res = await fetch('/api/payments/admin-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: selectedItem.account_id,
          user_id: selectedItem.user_id,
          platform_amount: platformAmount,
          percentage_applied: selectedItem.percentage,
          amount_owed: amountOwed,
          amount_paid: amountPaid,
          payment_method: reportForm.payment_method,
          payment_reference: reportForm.payment_reference || null,
          notes: reportForm.notes || null,
          auto_confirm: reportForm.auto_confirm,
          admin_id: adminUser?.id,
        }),
      });

      const json = await res.json();
      if (json.success) {
        toast.success(reportForm.auto_confirm ? 'Payment reported and confirmed' : 'Payment reported');
        setReportDialogOpen(false);
        setSelectedItem(null);
        await fetchData();
      } else {
        toast.error(json.error || 'Failed to submit report');
      }
    } catch (error) {
      toast.error('Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  const calculatedAmountOwed = () => {
    if (!selectedItem || !reportForm.platform_amount) return 0;
    const platformAmount = parseFloat(reportForm.platform_amount);
    if (isNaN(platformAmount)) return 0;
    return (platformAmount * selectedItem.percentage) / 100;
  };

  const getInitials = (name: string | null) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getList = (): DueAccountInfo[] => {
    if (!data) return [];
    if (selectedTab === 'all') return data.all;
    const map: Record<string, DueAccountInfo[]> = {
      overdue: data.overdue,
      due_today: data.dueToday,
      due_soon: data.dueSoon,
      upcoming: data.upcoming,
      reported: data.reported,
      confirmed: data.confirmed,
    };
    return map[selectedTab] || [];
  };

  const filteredList = getList().filter(item => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.account_name?.toLowerCase().includes(q) ||
      item.user_name?.toLowerCase().includes(q) ||
      item.platform_name?.toLowerCase().includes(q) ||
      item.account_email?.toLowerCase().includes(q)
    );
  });

  const canReport = (item: DueAccountInfo) =>
    item.status === 'overdue' || item.status === 'due_today' || item.status === 'due_soon';

  const sendWhatsApp = (item: DueAccountInfo) => {
    if (!item.user_phone) {
      toast.error(`${item.user_name || 'User'} has no phone number on file`);
      return;
    }
    const dueDate = new Date(item.next_payment_date);
    const formattedDate = format(dueDate, 'MMM d, yyyy');
    const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://reportpayment.blackgoatt.com';

    let message: string;
    if (item.status === 'overdue') {
      const daysOverdue = Math.abs(item.days_until_due);
      message =
        `Hi ${item.user_name || ''},\n\n` +
        `⏰ Overdue payment reminder (${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}):\n\n` +
        `📋 Account: ${item.account_name}\n` +
        `🏢 Platform: ${item.platform_name}\n` +
        `📅 Was due: ${formattedDate}\n` +
        `💰 Your percentage: ${item.percentage}%\n\n` +
        `Please report your payment in the app:\n${appUrl}`;
    } else if (item.status === 'due_today') {
      message =
        `Hi ${item.user_name || ''},\n\n` +
        `⏰ Payment is due TODAY:\n\n` +
        `📋 Account: ${item.account_name}\n` +
        `🏢 Platform: ${item.platform_name}\n` +
        `💰 Your percentage: ${item.percentage}%\n\n` +
        `Don't forget to report your payment in the app:\n${appUrl}`;
    } else {
      message =
        `Hi ${item.user_name || ''},\n\n` +
        `📅 Upcoming payment reminder (${formattedDate}):\n\n` +
        `📋 Account: ${item.account_name}\n` +
        `🏢 Platform: ${item.platform_name}\n` +
        `💰 Your percentage: ${item.percentage}%\n\n` +
        `When you make the payment, report it here:\n${appUrl}`;
    }

    const cleanPhone = item.user_phone.replace(/\D/g, '');
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${cleanPhone}?text=${encoded}`, '_blank');
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
          <h1 className="text-2xl font-bold">Due Payments</h1>
          <p className="text-muted-foreground">
            Who needs to pay, who reported, and who is overdue
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fetchData(true)} disabled={refreshing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={sendReminders} disabled={sendingReminders} className="gap-2">
            {sendingReminders ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
            Send Reminders
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {(['overdue', 'due_today', 'due_soon', 'upcoming', 'reported', 'confirmed'] as const).map((key) => {
          const cfg = statusConfig[key];
          const count = data?.summary[key === 'due_today' ? 'dueToday' : key === 'due_soon' ? 'dueSoon' : key] || 0;
          const Icon = cfg.icon;
          return (
            <Card
              key={key}
              className={`cursor-pointer transition-all hover:shadow-md active:scale-[0.98] ${selectedTab === key ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setSelectedTab(key)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground font-medium">{cfg.label}</p>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-2xl font-bold">{count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by user, account, platform..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="overdue">Overdue</TabsTrigger>
            <TabsTrigger value="due_today">Today</TabsTrigger>
            <TabsTrigger value="due_soon">Soon</TabsTrigger>
            <TabsTrigger value="reported">Reported</TabsTrigger>
            <TabsTrigger value="confirmed">Confirmed</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {filteredList.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">No accounts in this category</p>
              <p className="text-sm">Try selecting a different tab</p>
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="divide-y">
                {filteredList.map((item) => {
                  const cfg = statusConfig[item.status];
                  const Icon = cfg.icon;
                  const dueDate = new Date(item.next_payment_date);
                  return (
                    <div
                      key={item.account_id}
                      className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50"
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {getInitials(item.user_name)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{item.account_name}</p>
                          <Badge variant="outline" className="shrink-0 text-xs">
                            {item.platform_name}
                          </Badge>
                          {item.project_name && (
                            <Badge variant="outline" className="shrink-0 text-xs bg-teal-50">
                              {item.project_name}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{item.user_name || 'Unassigned'}</span>
                          {item.user_username && (
                            <>
                              <span>•</span>
                              <span>@{item.user_username}</span>
                            </>
                          )}
                          <span>•</span>
                          <span className="capitalize">{item.payment_frequency}</span>
                          <span>•</span>
                          <span>{item.percentage}%</span>
                        </div>
                      </div>

                      <div className="text-right hidden md:block">
                        <p className="text-sm font-medium">
                          {format(dueDate, 'MMM d, yyyy')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.days_until_due < 0
                            ? `${Math.abs(item.days_until_due)} days overdue`
                            : item.days_until_due === 0
                              ? 'Today'
                              : `In ${item.days_until_due} days`}
                        </p>
                      </div>

                      <Badge className={`${cfg.color} gap-1 border`}>
                        <Icon className="h-3 w-3" />
                        {cfg.label}
                      </Badge>

                      {(item.status === 'overdue' || item.status === 'due_today' || item.status === 'due_soon') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => sendWhatsApp(item)}
                          className={`gap-1 ${item.user_phone ? 'text-green-700 border-green-300 hover:bg-green-50' : 'text-muted-foreground'}`}
                          title={item.user_phone ? `WhatsApp ${item.user_phone}` : 'No phone on file'}
                        >
                          <MessageCircle className="h-3 w-3" />
                          <span className="hidden sm:inline">WhatsApp</span>
                        </Button>
                      )}

                      {canReport(item) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openReportDialog(item)}
                          className="gap-1"
                        >
                          <DollarSign className="h-3 w-3" />
                          Report
                        </Button>
                      )}

                      {item.current_payment_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => router.push(`/dashboard/payments?payment=${item.current_payment_id}`)}
                        >
                          View
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Admin Report Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report Payment (Admin)</DialogTitle>
            <DialogDescription>
              Submit a payment report on behalf of {selectedItem?.user_name || 'user'} for {selectedItem?.account_name}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Account info */}
            <div className="rounded-lg bg-muted p-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-muted-foreground">Platform:</span>
                <span>{selectedItem?.platform_name}</span>
                <span className="text-muted-foreground">Percentage:</span>
                <span className="font-semibold text-primary">{selectedItem?.percentage}%</span>
              </div>
            </div>

            {/* Platform amount */}
            <div className="grid gap-2">
              <Label>Company Paid ($) *</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="Amount the company paid"
                value={reportForm.platform_amount}
                onChange={(e) => {
                  const value = e.target.value;
                  const platformAmt = parseFloat(value);
                  setReportForm({
                    ...reportForm,
                    platform_amount: value,
                    amount_paid: !isNaN(platformAmt) && selectedItem
                      ? ((platformAmt * selectedItem.percentage) / 100).toFixed(2)
                      : '',
                  });
                }}
              />
            </div>

            {/* Calculated owed */}
            {reportForm.platform_amount && selectedItem && (
              <div className="rounded-lg bg-primary/10 p-3 border border-primary/20 text-sm">
                <div className="flex justify-between">
                  <span>Should pay:</span>
                  <span className="font-bold">${calculatedAmountOwed().toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Amount paid */}
            <div className="grid gap-2">
              <Label>Amount Sent ($) *</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="What the user actually sent"
                value={reportForm.amount_paid}
                onChange={(e) => setReportForm({ ...reportForm, amount_paid: e.target.value })}
              />
            </div>

            {/* Payment method */}
            <div className="grid gap-2">
              <Label>Payment Method</Label>
              <Select
                value={reportForm.payment_method}
                onValueChange={(value) => setReportForm({ ...reportForm, payment_method: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.length > 0 ? (
                    paymentMethods.map((m) => (
                      <SelectItem key={m.id} value={m.type}>
                        {m.display_name || m.type}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="other">Other</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Reference */}
            <div className="grid gap-2">
              <Label>Reference (optional)</Label>
              <Input
                placeholder="Tx hash, confirmation number..."
                value={reportForm.payment_reference}
                onChange={(e) => setReportForm({ ...reportForm, payment_reference: e.target.value })}
              />
            </div>

            {/* Notes */}
            <div className="grid gap-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Why are you reporting on behalf?"
                value={reportForm.notes}
                onChange={(e) => setReportForm({ ...reportForm, notes: e.target.value })}
                className="min-h-[60px]"
              />
            </div>

            {/* Auto-confirm switch */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="font-medium">Auto-confirm</Label>
                <p className="text-xs text-muted-foreground">
                  Skip review and mark as confirmed immediately
                </p>
              </div>
              <Switch
                checked={reportForm.auto_confirm}
                onCheckedChange={(checked) => setReportForm({ ...reportForm, auto_confirm: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmitReport} disabled={submitting || !reportForm.platform_amount || !reportForm.amount_paid}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : reportForm.auto_confirm ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Report & Confirm
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Report
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
