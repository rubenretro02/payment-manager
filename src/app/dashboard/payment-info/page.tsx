'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  RefreshCw,
  Wallet,
  CreditCard,
  Building,
  Copy,
  Check,
  Star,
  Info,
} from 'lucide-react';

interface PaymentMethod {
  id: string;
  type: string;
  display_name: string;
  details: string;
  instructions: string | null;
  is_active: boolean;
  is_primary: boolean;
}

// Dynamic icon based on type name
const getTypeIcon = (type: string) => {
  const lowerType = type.toLowerCase();
  if (lowerType.includes('zelle')) return Wallet;
  if (lowerType.includes('binance') || lowerType.includes('crypto')) return CreditCard;
  if (lowerType.includes('bank') || lowerType.includes('transfer')) return Building;
  return CreditCard;
};

export default function PaymentInfoPage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchMethods();
  }, []);

  async function fetchMethods(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    try {
      const response = await fetch('/api/payment-methods');
      const data = await response.json();
      if (data.success) {
        const activeMethods = (data.data || []).filter((m: PaymentMethod) => m.is_active);
        setMethods(activeMethods);
      }
    } catch (error) {
      console.error('Error fetching payment methods:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const handleRefresh = () => {
    fetchMethods(true);
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
          <h1 className="text-xl font-bold">Payment Information</h1>
          <p className="text-sm text-muted-foreground">
            Where to send your payments
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Info Banner */}
      <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-300">
              <p className="font-medium mb-1">How to pay:</p>
              <ol className="list-decimal list-inside space-y-1 text-blue-700 dark:text-blue-400">
                <li>Tap on a payment method below to copy the details</li>
                <li>Open your payment app (Zelle, Binance, etc.)</li>
                <li>Send the amount you owe</li>
                <li>Take a screenshot of the payment</li>
                <li>Go to Accounts → Report Payment</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Methods */}
      {methods.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Wallet className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-medium text-lg">No payment methods</h3>
            <p className="text-muted-foreground text-sm">
              Contact your admin to set up payment methods
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {methods.map((method) => {
            const Icon = getTypeIcon(method.type);
            const isCopied = copiedId === method.id;

            return (
              <Card
                key={method.id}
                className={`cursor-pointer transition-all active:scale-[0.98] ${
                  method.is_primary
                    ? 'border-2 border-primary shadow-sm'
                    : 'hover:border-primary/50'
                } ${isCopied ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : ''}`}
                onClick={() => copyToClipboard(method.details, method.id)}
              >
                <CardContent className="p-4">
                  {method.is_primary && (
                    <Badge className="bg-yellow-500 text-xs gap-1 mb-2">
                      <Star className="h-3 w-3" />
                      Preferred Method
                    </Badge>
                  )}

                  <div className="flex items-start gap-3">
                    <div className={`p-3 rounded-full ${method.is_primary ? 'bg-primary/20' : 'bg-muted'}`}>
                      <Icon className={`h-6 w-6 ${method.is_primary ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-lg">{method.display_name || method.type}</p>
                      <p className="font-mono text-sm bg-muted px-2 py-1 rounded mt-1 break-all">
                        {method.details}
                      </p>
                      {method.instructions && (
                        <p className="text-xs text-muted-foreground mt-2">
                          {method.instructions}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 self-center">
                      {isCopied ? (
                        <div className="flex flex-col items-center text-green-600">
                          <Check className="h-6 w-6" />
                          <span className="text-xs font-medium">Copied!</span>
                        </div>
                      ) : (
                        <Copy className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Footer note */}
      <p className="text-xs text-center text-muted-foreground px-4">
        After sending payment, remember to report it in the Accounts tab with a screenshot
      </p>
    </div>
  );
}
