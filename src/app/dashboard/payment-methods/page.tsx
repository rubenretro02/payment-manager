'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  MoreHorizontal,
  Edit,
  Trash2,
  Loader2,
  CreditCard,
  Wallet,
  Building,
  Star,
  Copy,
  Check,
} from 'lucide-react';

interface PaymentMethod {
  id: string;
  type: string;
  display_name: string;
  details: string;
  instructions: string | null;
  is_active: boolean;
  is_primary: boolean;
  created_at: string;
}

// Dynamic icon based on type name
const getTypeIcon = (type: string) => {
  const lowerType = type.toLowerCase();
  if (lowerType.includes('zelle')) return Wallet;
  if (lowerType.includes('binance') || lowerType.includes('crypto')) return CreditCard;
  if (lowerType.includes('bank') || lowerType.includes('transfer')) return Building;
  return CreditCard;
};

export default function PaymentMethodsPage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    type: 'zelle',
    display_name: '',
    details: '',
    instructions: '',
    is_active: true,
    is_primary: false,
  });

  useEffect(() => {
    fetchMethods();
  }, []);

  async function fetchMethods() {
    try {
      const response = await fetch('/api/payment-methods');
      const data = await response.json();
      if (data.success) {
        setMethods(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching payment methods:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleAdd = async () => {
    try {
      const response = await fetch('/api/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (data.success) {
        await fetchMethods();
        setIsAddDialogOpen(false);
        resetForm();
      } else {
        alert('Error: ' + (data.error || 'Failed to add payment method'));
      }
    } catch (error) {
      console.error('Error adding payment method:', error);
    }
  };

  const handleEdit = async () => {
    if (!selectedMethod) return;
    try {
      const response = await fetch(`/api/payment-methods/${selectedMethod.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (data.success) {
        await fetchMethods();
        setIsEditDialogOpen(false);
        setSelectedMethod(null);
        resetForm();
      } else {
        alert('Error: ' + (data.error || 'Failed to update payment method'));
      }
    } catch (error) {
      console.error('Error editing payment method:', error);
    }
  };

  const handleDelete = async () => {
    if (!selectedMethod) return;
    try {
      const response = await fetch(`/api/payment-methods/${selectedMethod.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        await fetchMethods();
        setIsDeleteDialogOpen(false);
        setSelectedMethod(null);
      } else {
        alert('Error: ' + (data.error || 'Failed to delete payment method'));
      }
    } catch (error) {
      console.error('Error deleting payment method:', error);
    }
  };

  const openEditDialog = (method: PaymentMethod) => {
    setSelectedMethod(method);
    setFormData({
      type: method.type,
      display_name: method.display_name,
      details: method.details,
      instructions: method.instructions || '',
      is_active: method.is_active,
      is_primary: method.is_primary,
    });
    setIsEditDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      type: 'zelle',
      display_name: '',
      details: '',
      instructions: '',
      is_active: true,
      is_primary: false,
    });
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

  const getPlaceholder = (type: string) => {
    switch (type) {
      case 'zelle':
        return 'email@example.com or phone number';
      case 'binance':
        return 'Binance Pay ID or email';
      case 'bank':
        return 'Account number, routing number, bank name...';
      default:
        return 'Payment details...';
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
          <h1 className="text-2xl font-bold">Payment Methods</h1>
          <p className="text-muted-foreground">
            Manage your payment details that users will use to send payments
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={resetForm}>
              <Plus className="h-4 w-4" />
              Add Payment Method
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Payment Method</DialogTitle>
              <DialogDescription>
                Add your payment details so users know where to send payments.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="type">Type / Name *</Label>
                <Input
                  id="type"
                  placeholder="e.g., Zelle, Binance, PayPal, Bank of America..."
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Name this payment method however you want
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="display_name">Display Name (optional)</Label>
                <Input
                  id="display_name"
                  placeholder="e.g., My personal Zelle"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="details">Payment Details *</Label>
                <Textarea
                  id="details"
                  placeholder={getPlaceholder(formData.type)}
                  value={formData.details}
                  onChange={(e) => setFormData({ ...formData, details: e.target.value })}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  This is what users will see and use to send payments
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="instructions">Instructions (optional)</Label>
                <Textarea
                  id="instructions"
                  placeholder="Any special instructions for users..."
                  value={formData.instructions}
                  onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Active</Label>
                  <p className="text-xs text-muted-foreground">Show to users</p>
                </div>
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Primary</Label>
                  <p className="text-xs text-muted-foreground">Preferred payment method</p>
                </div>
                <Switch
                  checked={formData.is_primary}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_primary: checked })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAdd}
                disabled={!formData.display_name || !formData.details}
              >
                Add Method
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Methods</p>
                <p className="text-2xl font-bold">{methods.length}</p>
              </div>
              <CreditCard className="h-8 w-8 text-muted-foreground/20" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold text-green-600">
                  {methods.filter(m => m.is_active).length}
                </p>
              </div>
              <Check className="h-8 w-8 text-green-600/20" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Primary</p>
                <p className="text-2xl font-bold text-primary">
                  {methods.filter(m => m.is_primary).length}
                </p>
              </div>
              <Star className="h-8 w-8 text-primary/20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Methods List */}
      <Card>
        <CardContent className="p-0">
          {methods.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">No payment methods</p>
              <p className="text-sm">Add your payment details so users know where to send payments</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Instructions</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {methods.map((method) => {
                  const Icon = getTypeIcon(method.type);
                  return (
                    <TableRow key={method.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Icon className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{method.type}</span>
                              {method.is_primary && (
                                <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                              )}
                            </div>
                            {method.display_name && (
                              <span className="text-xs text-muted-foreground">
                                {method.display_name}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="text-sm bg-muted px-2 py-1 rounded max-w-[200px] truncate">
                            {method.details}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => copyToClipboard(method.details, method.id)}
                          >
                            {copiedId === method.id ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                        {method.instructions || '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={method.is_active
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                        }>
                          {method.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openEditDialog(method)}>
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                setSelectedMethod(method);
                                setIsDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* User Preview */}
      {methods.filter(m => m.is_active).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">User Preview</CardTitle>
            <CardDescription>This is how users will see your payment methods</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {methods.filter(m => m.is_active).map((method) => {
                const Icon = getTypeIcon(method.type);
                return (
                  <div
                    key={method.id}
                    className={`rounded-lg border p-4 ${method.is_primary ? 'border-primary bg-primary/5' : ''}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="font-medium">{method.display_name || method.type}</span>
                      {method.is_primary && (
                        <Badge className="bg-primary text-primary-foreground text-xs">Preferred</Badge>
                      )}
                    </div>
                    <code className="text-sm bg-muted px-2 py-1 rounded block mb-2">
                      {method.details}
                    </code>
                    {method.instructions && (
                      <p className="text-xs text-muted-foreground">{method.instructions}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Payment Method</DialogTitle>
            <DialogDescription>
              Update your payment details.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_type">Type / Name *</Label>
              <Input
                id="edit_type"
                placeholder="e.g., Zelle, Binance, PayPal..."
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_display_name">Display Name (optional)</Label>
              <Input
                id="edit_display_name"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_details">Payment Details *</Label>
              <Textarea
                id="edit_details"
                value={formData.details}
                onChange={(e) => setFormData({ ...formData, details: e.target.value })}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_instructions">Instructions</Label>
              <Textarea
                id="edit_instructions"
                value={formData.instructions}
                onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                rows={2}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Primary</Label>
              <Switch
                checked={formData.is_primary}
                onCheckedChange={(checked) => setFormData({ ...formData, is_primary: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Payment Method</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{selectedMethod?.display_name}"?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
