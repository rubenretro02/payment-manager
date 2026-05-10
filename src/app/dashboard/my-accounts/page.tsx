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
} from 'lucide-react';
import { format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import type { Account, Payment, PaymentFrequency } from '@/lib/types';
import {
  formatPaymentFrequency,
  formatPaymentSchedule,
  calculateNextPaymentDate,
  getUpcomingPaymentDates
} from '@/lib/payment-dates';

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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [adminPaymentMethods, setAdminPaymentMethods] = useState<AdminPaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedReportPayment, setSelectedReportPayment] = useState<Payment | null>(null);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [isNoPaymentDialogOpen, setIsNoPaymentDialogOpen] = useState(false);
  const [isViewReportDialogOpen, setIsViewReportDialogOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

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

      if (accountsData.success) setAccounts(accountsData.data || []);
      if (paymentsData.success) setPayments(paymentsData.data || []);
      if (methodsData.success) {
        const activeMethods = (methodsData.data || []).filter((m: AdminPaymentMethod) => m.is_active);
        setAdminPaymentMethods(activeMethods);
        const primary = activeMethods.find((m: AdminPaymentMethod) => m.is_primary);
        if (primary) {
          setPaymentForm(prev => ({ ...prev, payment_method: primary.id }));
        } else if (activeMethods.length > 0) {
          setPaymentForm(prev => ({ ...prev, payment_method: activeMethods[0].id }));
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Get the most recent payment for the current period of an account.
  // Returns null if there's no submitted/confirmed payment in the current period
  // (or only a rejected one — in that case user should report again).
  const getCurrentPeriodReport = (account: Account): Payment | null => {
    const frequency = account.payment_frequency || 'weekly';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const periodStart = new Date(today);
    if (frequency === 'weekly') periodStart.setDate(periodStart.getDate() - 7);
    else if (frequency === 'biweekly') periodStart.setDate(periodStart.getDate() - 14);
    else periodStart.setDate(periodStart.getDate() - 31);

    return payments
      .filter(p =>
        p.account_id === account.id &&
        (p.status === 'submitted' || p.status === 'confirmed') &&
        new Date(p.created_at) >= periodStart
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null;
  };

  useEffect(() => {
    if (user?.id) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleRefresh = () => {
    fetchData(true);
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

    // Detect if the reference field contains a Base tx hash — server will re-verify
    const refValue = (paymentForm.payment_reference || '').trim();
    const looksLikeTxHash = /^0x[a-fA-F0-9]{64}$/.test(refValue);
    const accountHasBaseWallet = !!selectedAccount.wallet_address && (selectedAccount.wallet_network || 'base') === 'base';
    const canAutoVerify = looksLikeTxHash && accountHasBaseWallet;

    // Payment screenshot required unless we can auto-verify on the blockchain
    if (!paymentProofImage && !canAutoVerify) {
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
      // Only include fields that are safe for the database
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
        // Use Telegram URLs if available, otherwise use base64 preview
        company_screenshot_url: companyProofImage.telegramUrl || companyProofImage.preview,
      };

      // Payment screenshot only if user uploaded one
      if (paymentProofImage) {
        paymentData.payment_screenshot_url = paymentProofImage.telegramUrl || paymentProofImage.preview;
      }

      // If the reference field is a Base tx hash, let the server re-verify it
      // and auto-confirm if it matches the account's wallet.
      if (canAutoVerify) {
        paymentData.verified_tx_hash = refValue;
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
        setIsPaymentDialogOpen(false);
        resetForm();
        const wasAutoConfirmed = data.data?.status === 'confirmed';
        alert(
          wasAutoConfirmed
            ? '✓ Payment auto-confirmed via blockchain verification! Thank you.'
            : 'Payment submitted successfully! Admin will review it. You will receive a notification when it is confirmed.'
        );
        await fetchData();
      } else {
        console.error('Payment error:', data.error);
        alert('Error: ' + (data.error || 'Failed to submit payment'));
      }
    } catch (error) {
      console.error('Error submitting payment:', error);
      alert('Error submitting payment. Please try again.');
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
      <Label>{label} *</Label>
      <div className="border-2 border-dashed rounded-lg p-4">
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
        const filteredAccounts = statusFilter
          ? accounts.filter(a => a.status === statusFilter)
          : accounts;

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
            const nextPayment = getNextPayment(account);
            const isPaymentDue = nextPayment <= new Date();

            return (
              <Card key={account.id} className={isPaymentDue ? 'border-yellow-500' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{account.full_name}</CardTitle>
                      <CardDescription>{account.account_email}</CardDescription>
                    </div>
                    <Badge className={statusColors[account.status] || statusColors.not_in_project}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {statusLabels[account.status] || account.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Platform & Project */}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {account.platform?.display_name || 'Platform'}
                    </Badge>
                    {account.project && (
                      <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400">
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
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Frequency:</span>
                      <span>{formatPaymentFrequency(account.payment_frequency || 'weekly')}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Next payment:</span>
                      <span className={isPaymentDue ? 'text-yellow-600 font-medium' : ''}>
                        {format(nextPayment, "MMM d, yyyy", { locale: enUS })}
                      </span>
                    </div>
                  </div>

                  {/* Actions - Only show Report Payment for production/nesting accounts */}
                  {(account.status === 'production' || account.status === 'nesting') && (() => {
                    const currentReport = getCurrentPeriodReport(account);

                    // Already reported for this period — show status + view + add another
                    if (currentReport) {
                      const isConfirmed = currentReport.status === 'confirmed';
                      return (
                        <div className="space-y-2">
                          <div className={`rounded-lg border p-3 flex items-center gap-2 ${
                            isConfirmed
                              ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'
                              : 'bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800'
                          }`}>
                            {isConfirmed ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                            ) : (
                              <Send className="h-4 w-4 text-purple-600 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${
                                isConfirmed ? 'text-green-700 dark:text-green-400' : 'text-purple-700 dark:text-purple-400'
                              }`}>
                                {isConfirmed ? 'Reported & Confirmed' : 'Reported – Awaiting Confirmation'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                ${Number(currentReport.amount_paid || 0).toFixed(2)} on {format(new Date(currentReport.created_at), 'MMM d')}
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
                              <Plus className="h-4 w-4 mr-2" />
                              Add another
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

                  {/* For non-production/nesting accounts, only show schedule */}
                  {account.status !== 'production' && account.status !== 'nesting' && (
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
            <DialogTitle>Report Payment</DialogTitle>
            <DialogDescription>
              Submit your payment for {selectedAccount?.full_name}
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

            {/* Company Paid */}
            <div className="grid gap-2">
              <Label htmlFor="platform_amount">Company Paid ($) *</Label>
              <Input
                id="platform_amount"
                type="number"
                step="0.01"
                placeholder="Enter the amount the company paid you"
                value={paymentForm.platform_amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, platform_amount: e.target.value })}
              />
            </div>

            {/* Screenshot 1: Company Payment Proof */}
            <ImageUploadBox
              type="company"
              label="Company Payment Screenshot"
              image={companyProofImage}
              inputRef={companyProofInputRef}
              cameraRef={companyCameraInputRef}
            />

            {/* Amount to Send (calculated) */}
            {paymentForm.platform_amount && selectedAccount && (
              <div className="rounded-lg bg-primary/10 p-3 border border-primary/20">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Amount to Send:</span>
                  <span className="text-lg font-bold text-primary">
                    ${calculateAmountOwed(parseFloat(paymentForm.platform_amount), selectedAccount.percentage).toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedAccount.percentage}% of ${parseFloat(paymentForm.platform_amount).toFixed(2)}
                </p>
              </div>
            )}

            {/* Amount Sent */}
            <div className="grid gap-2">
              <Label htmlFor="amount_sent">Amount Sent ($) *</Label>
              <Input
                id="amount_sent"
                type="number"
                step="0.01"
                placeholder="Enter the exact amount you sent"
                value={paymentForm.amount_sent}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount_sent: e.target.value })}
              />
              {paymentForm.amount_sent && paymentForm.platform_amount && selectedAccount && (
                <p className="text-xs text-muted-foreground">
                  {parseFloat(paymentForm.amount_sent) === calculateAmountOwed(parseFloat(paymentForm.platform_amount), selectedAccount.percentage) ? (
                    <span className="text-green-600">Exact amount</span>
                  ) : parseFloat(paymentForm.amount_sent) < calculateAmountOwed(parseFloat(paymentForm.platform_amount), selectedAccount.percentage) ? (
                    <span className="text-yellow-600">
                      Difference: -${(calculateAmountOwed(parseFloat(paymentForm.platform_amount), selectedAccount.percentage) - parseFloat(paymentForm.amount_sent)).toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-blue-600">
                      Overpaid: +${(parseFloat(paymentForm.amount_sent) - calculateAmountOwed(parseFloat(paymentForm.platform_amount), selectedAccount.percentage)).toFixed(2)}
                    </span>
                  )}
                </p>
              )}
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
                <div className="rounded-lg border-2 border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="h-4 w-4 text-orange-600" />
                    <span className="font-medium text-sm">Send to this wallet for {selectedAccount.full_name}</span>
                    <Badge className="bg-orange-500 text-xs uppercase">{selectedAccount.wallet_network || 'base'}</Badge>
                  </div>
                  <div className="flex items-center gap-2 bg-background/80 rounded-md p-2">
                    <code className="text-xs font-mono flex-1 break-all">
                      {selectedAccount.wallet_address}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => copyToClipboard(selectedAccount.wallet_address!, `wallet-${selectedAccount.id}`)}
                    >
                      {copiedId === `wallet-${selectedAccount.id}` ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-orange-700 dark:text-orange-400 mt-2">
                    ⚠️ Only send {(selectedAccount.wallet_network || 'base').toUpperCase()} network tokens to this address
                  </p>
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

            {/* Notes */}
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Any additional information..."
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
              />
            </div>
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
              disabled={
                !paymentForm.platform_amount ||
                !paymentForm.amount_sent ||
                !companyProofImage ||
                companyProofImage?.uploading ||
                paymentProofImage?.uploading ||
                isSubmitting ||
                adminPaymentMethods.length === 0
              }
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

            <h4 className="font-medium mb-3">Upcoming payment dates:</h4>
            <div className="space-y-2">
              {selectedAccount && getUpcomingPaymentDates(
                selectedAccount.payment_frequency || 'weekly',
                selectedAccount.payment_day ?? 5,
                6,
                new Date(),
                selectedAccount.biweekly_first_day,
                selectedAccount.biweekly_second_day
              ).map((date, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    i === 0 ? 'bg-green-100 dark:bg-green-900/30' : 'bg-muted'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Calendar className={`h-4 w-4 ${i === 0 ? 'text-green-600' : 'text-muted-foreground'}`} />
                    <div>
                      <p className={`font-medium ${i === 0 ? 'text-green-800 dark:text-green-300' : ''}`}>
                        {format(date, "EEEE, MMMM d", { locale: enUS })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(date, 'yyyy')}
                      </p>
                    </div>
                  </div>
                  {i === 0 && (
                    <Badge className="bg-green-600">Next</Badge>
                  )}
                </div>
              ))}
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
        if (!open) setNoPaymentForm({ reason: '' });
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
                <span className="text-muted-foreground">Expected payment:</span>
                <span>{selectedAccount && format(getNextPayment(selectedAccount), "MMM d, yyyy", { locale: enUS })}</span>
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
                  const paymentData = {
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

                  const response = await fetch('/api/payments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(paymentData),
                  });

                  const data = await response.json();

                  if (data.success) {
                    setIsNoPaymentDialogOpen(false);
                    setNoPaymentForm({ reason: '' });
                    alert('Issue reported successfully! Admin will review it.');
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

      {/* View Report Dialog */}
      <Dialog open={isViewReportDialogOpen} onOpenChange={setIsViewReportDialogOpen}>
        <DialogContent className="sm:max-w-md">
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
                  'bg-purple-100 text-purple-800'
                }`}>
                  {selectedReportPayment.status === 'submitted' ? 'Awaiting Confirmation' :
                   selectedReportPayment.status === 'confirmed' ? 'Confirmed' :
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
              {(selectedReportPayment.company_screenshot_url || selectedReportPayment.payment_screenshot_url) && (
                <div className="grid grid-cols-2 gap-2">
                  {selectedReportPayment.company_screenshot_url && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Company Payment</p>
                      <img
                        src={selectedReportPayment.company_screenshot_url}
                        alt="Company"
                        className="w-full rounded-lg border"
                      />
                    </div>
                  )}
                  {selectedReportPayment.payment_screenshot_url && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Payment Sent</p>
                      <img
                        src={selectedReportPayment.payment_screenshot_url}
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
