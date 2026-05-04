'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
  Search,
  Plus,
  MoreHorizontal,
  Building2,
  Edit,
  Trash2,
  UserPlus,
  UserMinus,
  Loader2,
  Briefcase,
  AlertTriangle,
  XCircle,
  X,
  Calendar,
  Clock,
  CreditCard,
  FolderOpen,
} from 'lucide-react';
import { format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import type { Account, Platform, User, PaymentFrequency, Project } from '@/lib/types';
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

// Statuses that require payment
const PAYMENT_REQUIRED_STATUSES = ['production', 'nesting'];

const frequencyColors: Record<string, string> = {
  weekly: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  biweekly: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  monthly: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  // Form state for new account
  const [newAccount, setNewAccount] = useState({
    full_name: '',
    account_email: '',
    platform_id: '',
    project_id: '',
    status: 'production' as 'production' | 'nesting' | 'active' | 'drop' | 'not_in_project',
    percentage: 50,
    payment_frequency: 'weekly' as PaymentFrequency,
    payment_day: 5, // Friday by default for weekly, day of month for monthly
    biweekly_first_day: 1, // First payment day for biweekly
    biweekly_second_day: 16, // Second payment day for biweekly
  });

  const [assignUserId, setAssignUserId] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [accountsRes, usersRes, platformsRes, projectsRes] = await Promise.all([
        fetch('/api/accounts'),
        fetch('/api/users'),
        fetch('/api/platforms'),
        fetch('/api/projects'),
      ]);

      const accountsData = await accountsRes.json();
      const usersData = await usersRes.json();
      const platformsData = await platformsRes.json();
      const projectsData = await projectsRes.json();

      console.log('Accounts data:', accountsData);
      console.log('Platforms data:', platformsData);
      console.log('Projects data:', projectsData);

      if (accountsData.success) setAccounts(accountsData.data || []);
      if (usersData.success) setUsers(usersData.data || []);
      if (platformsData.success) setPlatforms(platformsData.data || []);
      if (projectsData.success) setProjects(projectsData.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }

  // First filter by search, platform, and project (but NOT status - that's for clicking cards)
  const searchFilteredAccounts = accounts.filter((account) => {
    const matchesSearch = !searchQuery ||
      account.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.account_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.user?.telegram_first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.project?.display_name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPlatform = filterPlatform === 'all' || account.platform?.id === filterPlatform;
    const matchesProject = filterProject === 'all' || account.project?.id === filterProject || (filterProject === 'none' && !account.project_id);
    return matchesSearch && matchesPlatform && matchesProject;
  });

  // Then apply status filter for the final list
  const filteredAccounts = searchFilteredAccounts.filter((account) => {
    return filterStatus === 'all' || account.status === filterStatus;
  });

  // Check if any filter is active (for showing filtered vs total stats)
  const hasActiveFilter = searchQuery || filterPlatform !== 'all' || filterProject !== 'all';

  // Stats based on search-filtered accounts (so clicking cards filters within the search)
  const stats = {
    total: searchFilteredAccounts.length,
    production: searchFilteredAccounts.filter(a => a.status === 'production').length,
    nesting: searchFilteredAccounts.filter(a => a.status === 'nesting').length,
    active: searchFilteredAccounts.filter(a => a.status === 'active').length,
    drop: searchFilteredAccounts.filter(a => a.status === 'drop').length,
    not_in_project: searchFilteredAccounts.filter(a => a.status === 'not_in_project').length,
    assigned: searchFilteredAccounts.filter(a => a.user_id).length,
    requiresPayment: searchFilteredAccounts.filter(a => PAYMENT_REQUIRED_STATUSES.includes(a.status)).length,
  };

  // Total stats (always show totals somewhere for reference)
  const totalStats = {
    total: accounts.length,
    production: accounts.filter(a => a.status === 'production').length,
    nesting: accounts.filter(a => a.status === 'nesting').length,
    active: accounts.filter(a => a.status === 'active').length,
    drop: accounts.filter(a => a.status === 'drop').length,
    requiresPayment: accounts.filter(a => PAYMENT_REQUIRED_STATUSES.includes(a.status)).length,
  };

  // Filter users who can be assigned (IBOs and users)
  const assignableUsers = users.filter(u => u.role === 'ibo' || u.role === 'user');

  const getInitials = (name: string | null | undefined) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const handleAddAccount = async () => {
    try {
      // Prepare data - ensure project_id is null if empty
      const accountData = {
        ...newAccount,
        project_id: newAccount.project_id && newAccount.project_id !== "none" ? newAccount.project_id : null,
      };

      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountData),
      });
      const data = await response.json();
      console.log('Add account response:', data);
      if (data.success) {
        await fetchData();
        setIsAddDialogOpen(false);
        setNewAccount({
          full_name: '',
          account_email: '',
          platform_id: '',
          project_id: '',
          status: 'production',
          percentage: 50,
          payment_frequency: 'weekly',
          payment_day: 5,
          biweekly_first_day: 1,
          biweekly_second_day: 16,
        });
      } else {
        console.error('Error from API:', data.error);
        alert('Error: ' + (data.error || 'Failed to add account'));
      }
    } catch (error) {
      console.error('Error creating account:', error);
      alert('Error creating account. Check console for details.');
    }
  };

  const handleAssignUser = async () => {
    if (!selectedAccount) return;
    try {
      const userId = assignUserId === "unassigned" || !assignUserId ? null : assignUserId;
      console.log('Assigning user:', userId, 'to account:', selectedAccount.id);

      const response = await fetch(`/api/accounts/${selectedAccount.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await response.json();
      console.log('Assign response:', data);

      if (data.success) {
        await fetchData();
        setIsAssignDialogOpen(false);
        setSelectedAccount(null);
        setAssignUserId('');
      } else {
        alert('Error: ' + (data.error || 'Failed to assign user'));
      }
    } catch (error) {
      console.error('Error assigning user:', error);
      alert('Error assigning user. Check console for details.');
    }
  };

  const handleEditAccount = async () => {
    if (!selectedAccount) return;
    try {
      const accountData = {
        ...newAccount,
        project_id: newAccount.project_id && newAccount.project_id !== "none" ? newAccount.project_id : null,
      };

      const response = await fetch(`/api/accounts/${selectedAccount.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountData),
      });
      const data = await response.json();
      if (data.success) {
        await fetchData();
        setIsEditDialogOpen(false);
        setSelectedAccount(null);
        setNewAccount({
          full_name: '',
          account_email: '',
          platform_id: '',
          project_id: '',
          status: 'production',
          percentage: 50,
          payment_frequency: 'weekly',
          payment_day: 5,
          biweekly_first_day: 1,
          biweekly_second_day: 16,
        });
      } else {
        alert('Error: ' + (data.error || 'Failed to update account'));
      }
    } catch (error) {
      console.error('Error updating account:', error);
      alert('Error updating account');
    }
  };

  const handleDeleteAccount = async () => {
    if (!selectedAccount) return;
    try {
      const response = await fetch(`/api/accounts/${selectedAccount.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        await fetchData();
        setIsDeleteDialogOpen(false);
        setSelectedAccount(null);
      } else {
        alert('Error: ' + (data.error || 'Failed to delete account'));
      }
    } catch (error) {
      console.error('Error deleting account:', error);
      alert('Error deleting account');
    }
  };

  const openEditDialog = (account: Account) => {
    setSelectedAccount(account);
    setNewAccount({
      full_name: account.full_name || '',
      account_email: account.account_email || '',
      platform_id: account.platform_id || '',
      project_id: account.project_id || '',
      status: account.status || 'production',
      percentage: account.percentage || 50,
      payment_frequency: account.payment_frequency || 'weekly',
      payment_day: account.payment_day ?? 5,
      biweekly_first_day: account.biweekly_first_day ?? 1,
      biweekly_second_day: account.biweekly_second_day ?? 16,
    });
    setIsEditDialogOpen(true);
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
          <h1 className="text-2xl font-bold">Work Accounts</h1>
          <p className="text-muted-foreground">
            Manage accounts you assign to IBOs and users
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Account
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Account</DialogTitle>
              <DialogDescription>
                Register a new work account to assign to an IBO or user.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {/* Basic Info */}
              <div className="grid gap-2">
                <Label htmlFor="full_name">Full Name *</Label>
                <Input
                  id="full_name"
                  placeholder="John Doe"
                  value={newAccount.full_name}
                  onChange={(e) => setNewAccount({ ...newAccount, full_name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="account_email">Account Email *</Label>
                <Input
                  id="account_email"
                  type="email"
                  placeholder="account@email.com"
                  value={newAccount.account_email}
                  onChange={(e) => setNewAccount({ ...newAccount, account_email: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Platform *</Label>
                  <Select
                    value={newAccount.platform_id}
                    onValueChange={(value) => setNewAccount({ ...newAccount, platform_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {platforms.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Project / Client</Label>
                  <Select
                    value={newAccount.project_id || "none"}
                    onValueChange={(value) => setNewAccount({ ...newAccount, project_id: value === "none" ? "" : value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select
                  value={newAccount.status}
                  onValueChange={(value: 'production' | 'nesting' | 'active' | 'drop' | 'not_in_project') =>
                    setNewAccount({ ...newAccount, status: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">
                      <span className="flex items-center gap-2">
                        Production <span className="text-xs text-green-600">(requires payment)</span>
                      </span>
                    </SelectItem>
                    <SelectItem value="nesting">
                      <span className="flex items-center gap-2">
                        Nesting <span className="text-xs text-yellow-600">(requires payment)</span>
                      </span>
                    </SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="drop">Drop</SelectItem>
                    <SelectItem value="not_in_project">No Project</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Only Production and Nesting accounts require payment
                </p>
              </div>

              {/* Payment Configuration */}
              <div className="border-t pt-4 mt-2">
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Payment Configuration
                </h4>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label>Payment Frequency</Label>
                    <Select
                      value={newAccount.payment_frequency}
                      onValueChange={(value: PaymentFrequency) => {
                        let defaultDay = 5; // Friday for weekly
                        if (value === 'biweekly') defaultDay = 1; // Not used, but kept
                        if (value === 'monthly') defaultDay = 1; // 1st of month
                        setNewAccount({ ...newAccount, payment_frequency: value, payment_day: defaultDay });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="biweekly">Bi-weekly (1st & 16th)</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {newAccount.payment_frequency === 'weekly' && (
                    <div className="grid gap-2">
                      <Label>Payment Day</Label>
                      <Select
                        value={String(newAccount.payment_day)}
                        onValueChange={(value) => setNewAccount({ ...newAccount, payment_day: Number(value) })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Monday</SelectItem>
                          <SelectItem value="2">Tuesday</SelectItem>
                          <SelectItem value="3">Wednesday</SelectItem>
                          <SelectItem value="4">Thursday</SelectItem>
                          <SelectItem value="5">Friday</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {newAccount.payment_frequency === 'biweekly' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label>First Payment Day</Label>
                        <Select
                          value={String(newAccount.biweekly_first_day)}
                          onValueChange={(value) => setNewAccount({ ...newAccount, biweekly_first_day: Number(value) })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                              <SelectItem key={day} value={String(day)}>Day {day}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Second Payment Day</Label>
                        <Select
                          value={String(newAccount.biweekly_second_day)}
                          onValueChange={(value) => setNewAccount({ ...newAccount, biweekly_second_day: Number(value) })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                              <SelectItem key={day} value={String(day)}>Day {day}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {newAccount.payment_frequency === 'monthly' && (
                    <div className="grid gap-2">
                      <Label>Day of Month</Label>
                      <Select
                        value={String(newAccount.payment_day)}
                        onValueChange={(value) => setNewAccount({ ...newAccount, payment_day: Number(value) })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                            <SelectItem key={day} value={String(day)}>Day {day}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Preview next payments */}
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">
                      Upcoming scheduled payments:
                    </p>
                    <div className="space-y-1">
                      {getUpcomingPaymentDates(
                        newAccount.payment_frequency,
                        newAccount.payment_day,
                        3,
                        new Date(),
                        newAccount.biweekly_first_day,
                        newAccount.biweekly_second_day
                      ).map((date, i) => (
                        <p key={i} className="text-sm text-blue-700 dark:text-blue-400">
                          {format(date, "EEEE, MMMM d, yyyy", { locale: enUS })}
                        </p>
                      ))}
                    </div>
                    <p className="text-xs text-blue-600/70 mt-2">
                      * Dates adjust automatically for weekends and US holidays
                    </p>
                  </div>
                </div>
              </div>

              {/* Percentage */}
              <div className="border-t pt-4 mt-2">
                <div className="grid gap-2">
                  <Label htmlFor="percentage">Payment Percentage (%)</Label>
                  <Input
                    id="percentage"
                    type="number"
                    min="0"
                    max="100"
                    value={newAccount.percentage}
                    onChange={(e) => setNewAccount({ ...newAccount, percentage: Number(e.target.value) })}
                  />
                  <p className="text-xs text-muted-foreground">
                    The assigned IBO/user will pay you this percentage of their earnings
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAddAccount}
                disabled={!newAccount.full_name || !newAccount.account_email || !newAccount.platform_id}
              >
                Add Account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats - Clickable Cards */}
      {hasActiveFilter && (
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            Showing filtered results for "{searchQuery || (filterPlatform !== 'all' ? 'platform' : 'project')}"
          </Badge>
          <span className="text-muted-foreground">
            ({stats.total} of {totalStats.total} accounts)
          </span>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card
          className={`cursor-pointer transition-all hover:border-primary/50 active:scale-[0.98] ${
            filterStatus === 'all' && !hasActiveFilter ? 'ring-2 ring-primary border-primary' : ''
          }`}
          onClick={() => { setFilterStatus('all'); setSearchQuery(''); setFilterPlatform('all'); setFilterProject('all'); }}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold">{stats.total}</p>
                  {hasActiveFilter && stats.total !== totalStats.total && (
                    <span className="text-sm text-muted-foreground">/ {totalStats.total}</span>
                  )}
                </div>
              </div>
              <Building2 className="h-8 w-8 text-muted-foreground/20" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:border-green-500/50 active:scale-[0.98] ${
            filterStatus === 'production' ? 'ring-2 ring-green-500 border-green-500' : ''
          }`}
          onClick={() => setFilterStatus(filterStatus === 'production' ? 'all' : 'production')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Production</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-green-600">{stats.production}</p>
                  {hasActiveFilter && stats.production !== totalStats.production && (
                    <span className="text-sm text-muted-foreground">/ {totalStats.production}</span>
                  )}
                </div>
              </div>
              <Briefcase className="h-8 w-8 text-green-600/20" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:border-yellow-500/50 active:scale-[0.98] ${
            filterStatus === 'nesting' ? 'ring-2 ring-yellow-500 border-yellow-500' : ''
          }`}
          onClick={() => setFilterStatus(filterStatus === 'nesting' ? 'all' : 'nesting')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Nesting</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-yellow-600">{stats.nesting}</p>
                  {hasActiveFilter && stats.nesting !== totalStats.nesting && (
                    <span className="text-sm text-muted-foreground">/ {totalStats.nesting}</span>
                  )}
                </div>
              </div>
              <Clock className="h-8 w-8 text-yellow-600/20" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:border-blue-500/50 active:scale-[0.98] ${
            filterStatus === 'active' ? 'ring-2 ring-blue-500 border-blue-500' : ''
          }`}
          onClick={() => setFilterStatus(filterStatus === 'active' ? 'all' : 'active')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-blue-600">{stats.active}</p>
                  {hasActiveFilter && stats.active !== totalStats.active && (
                    <span className="text-sm text-muted-foreground">/ {totalStats.active}</span>
                  )}
                </div>
              </div>
              <Briefcase className="h-8 w-8 text-blue-600/20" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:border-red-500/50 active:scale-[0.98] ${
            filterStatus === 'drop' ? 'ring-2 ring-red-500 border-red-500' : ''
          }`}
          onClick={() => setFilterStatus(filterStatus === 'drop' ? 'all' : 'drop')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Drop</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-red-600">{stats.drop}</p>
                  {hasActiveFilter && stats.drop !== totalStats.drop && (
                    <span className="text-sm text-muted-foreground">/ {totalStats.drop}</span>
                  )}
                </div>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-600/20" />
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:border-primary/50 active:scale-[0.98] border-primary/50`}
          onClick={() => {
            // Toggle between production+nesting (payment required) and all
            if (filterStatus === 'production' || filterStatus === 'nesting') {
              setFilterStatus('all');
            } else {
              setFilterStatus('production');
            }
          }}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Requires Payment</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-primary">{stats.requiresPayment}</p>
                  {hasActiveFilter && stats.requiresPayment !== totalStats.requiresPayment && (
                    <span className="text-sm text-muted-foreground">/ {totalStats.requiresPayment}</span>
                  )}
                </div>
              </div>
              <CreditCard className="h-8 w-8 text-primary/20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, project or assigned user..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={filterPlatform} onValueChange={setFilterPlatform}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  {platforms.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterProject} onValueChange={setFilterProject}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  <SelectItem value="none">No Project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="nesting">Nesting</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="drop">Drop</SelectItem>
                  <SelectItem value="not_in_project">No Project</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Counter */}
      {(searchQuery || filterStatus !== 'all' || filterPlatform !== 'all' || filterProject !== 'all') && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-sm font-medium">
              {filteredAccounts.length} {filteredAccounts.length === 1 ? 'account' : 'accounts'} found
            </Badge>
            {searchQuery && (
              <span className="text-sm text-muted-foreground">
                for "{searchQuery}"
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setFilterStatus('all');
              setFilterPlatform('all');
              setFilterProject('all');
            }}
          >
            Clear filters
          </Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filteredAccounts.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              {searchQuery || filterStatus !== 'all' ? (
                <>
                  <p className="font-medium">No accounts match your filters</p>
                  <p className="text-sm">Try adjusting your search or filters</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setSearchQuery('');
                      setFilterStatus('all');
                      setFilterPlatform('all');
                      setFilterProject('all');
                    }}
                  >
                    Clear all filters
                  </Button>
                </>
              ) : (
                <>
                  <p className="font-medium">No accounts registered</p>
                  <p className="text-sm">Add a new account to get started</p>
                </>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name / Email</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Project / Client</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Next Payment</TableHead>
                  <TableHead className="text-center">%</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAccounts.map((account) => {
                  const StatusIcon = statusIcons[account.status] || Briefcase;
                  const nextPayment = getNextPayment(account);
                  return (
                    <TableRow key={account.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{account.full_name}</p>
                          <p className="text-sm text-muted-foreground">{account.account_email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{account.platform?.display_name || 'N/A'}</Badge>
                      </TableCell>
                      <TableCell>
                        {account.project ? (
                          <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400">
                            <FolderOpen className="h-3 w-3 mr-1" />
                            {account.project.display_name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {account.user ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7">
                              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                {getInitials(account.user.telegram_first_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm">{account.user.telegram_first_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {account.user.role === 'ibo' ? 'IBO' : 'User'}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p className="font-medium">
                            {format(nextPayment, "MMM d", { locale: enUS })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatPaymentFrequency(account.payment_frequency || 'weekly')}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-semibold text-primary">{account.percentage}%</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[account.status] || statusColors.not_in_project}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {statusLabels[account.status] || account.status}
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
                            <DropdownMenuItem onClick={() => openEditDialog(account)}>
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedAccount(account);
                                setIsScheduleDialogOpen(true);
                              }}
                            >
                              <Calendar className="mr-2 h-4 w-4" />
                              View payment schedule
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedAccount(account);
                                setAssignUserId(account.user_id || '');
                                setIsAssignDialogOpen(true);
                              }}
                            >
                              {account.user ? (
                                <>
                                  <UserMinus className="mr-2 h-4 w-4" />
                                  Change assignment
                                </>
                              ) : (
                                <>
                                  <UserPlus className="mr-2 h-4 w-4" />
                                  Assign user
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                setSelectedAccount(account);
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

      {/* Assign User Dialog */}
      <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign User to Account</DialogTitle>
            <DialogDescription>
              Select the IBO or user who will work with this account.
              They will pay you {selectedAccount?.percentage}% of their earnings.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="rounded-lg bg-muted p-4 mb-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Account:</span>
                <span className="font-medium">{selectedAccount?.full_name}</span>
                <span className="text-muted-foreground">Email:</span>
                <span>{selectedAccount?.account_email}</span>
                <span className="text-muted-foreground">Platform:</span>
                <span>{selectedAccount?.platform?.display_name}</span>
                <span className="text-muted-foreground">Project:</span>
                <span>{selectedAccount?.project?.display_name || '—'}</span>
                <span className="text-muted-foreground">Percentage:</span>
                <span className="font-semibold text-primary">{selectedAccount?.percentage}%</span>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Assign to</Label>
              <Select
                value={assignUserId || "unassigned"}
                onValueChange={(value) => setAssignUserId(value === "unassigned" ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select IBO or user" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {assignableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.telegram_first_name}
                      {user.telegram_username && ` (@${user.telegram_username})`}
                      {' - '}
                      {user.role === 'ibo' ? 'IBO' : 'User'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAssignUser}>
              {assignUserId ? 'Assign' : 'Unassign'}
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
              {selectedAccount?.project && ` (${selectedAccount.project.display_name})`}
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
                <span className="text-muted-foreground">Project:</span>
                <span>{selectedAccount?.project?.display_name || '—'}</span>
                <span className="text-muted-foreground">Assigned to:</span>
                <span>
                  {selectedAccount?.user?.telegram_first_name || 'Unassigned'}
                </span>
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

            <p className="text-xs text-muted-foreground mt-4">
              * Dates are automatically adjusted if they fall on a weekend or US holiday
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsScheduleDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Account Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription>
              Update account information.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_full_name">Full Name *</Label>
              <Input
                id="edit_full_name"
                value={newAccount.full_name}
                onChange={(e) => setNewAccount({ ...newAccount, full_name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_account_email">Account Email *</Label>
              <Input
                id="edit_account_email"
                type="email"
                value={newAccount.account_email}
                onChange={(e) => setNewAccount({ ...newAccount, account_email: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Platform *</Label>
                <Select
                  value={newAccount.platform_id}
                  onValueChange={(value) => setNewAccount({ ...newAccount, platform_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {platforms.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Project / Client</Label>
                <Select
                  value={newAccount.project_id || "none"}
                  onValueChange={(value) => setNewAccount({ ...newAccount, project_id: value === "none" ? "" : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select
                  value={newAccount.status}
                  onValueChange={(value: 'production' | 'nesting' | 'active' | 'drop' | 'not_in_project') =>
                    setNewAccount({ ...newAccount, status: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Production</SelectItem>
                    <SelectItem value="nesting">Nesting</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="drop">Drop</SelectItem>
                    <SelectItem value="not_in_project">No Project</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_percentage">Percentage (%)</Label>
                <Input
                  id="edit_percentage"
                  type="number"
                  min="0"
                  max="100"
                  value={newAccount.percentage}
                  onChange={(e) => setNewAccount({ ...newAccount, percentage: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditAccount}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this account? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="rounded-lg bg-muted p-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Name:</span>
                <span className="font-medium">{selectedAccount?.full_name}</span>
                <span className="text-muted-foreground">Email:</span>
                <span>{selectedAccount?.account_email}</span>
                <span className="text-muted-foreground">Platform:</span>
                <span>{selectedAccount?.platform?.display_name || 'N/A'}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteAccount}>
              Delete Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project Summary */}
      {projects.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {projects.map((project) => {
            const projectAccounts = accounts.filter(
              a => a.project?.id === project.id
            );

            return (
              <Card key={project.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-teal-500" />
                    <CardTitle className="text-base">{project.display_name}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total:</span>
                      <span className="font-medium">{projectAccounts.length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Production:</span>
                      <span className="font-medium text-green-600">
                        {projectAccounts.filter(a => a.status === 'production').length}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Assigned:</span>
                      <span className="font-medium text-blue-600">
                        {projectAccounts.filter(a => a.user_id).length}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
