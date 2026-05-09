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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  UserPlus,
  Download,
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  Ban,
  CheckCircle,
  Users,
  Loader2,
  Calendar,
  Mail,
  AtSign,
  Shield,
  KeyRound,
  MessageCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import type { User } from '@/lib/types';

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  suspended: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const statusLabels: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  suspended: 'Suspended',
};

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  ibo: 'IBO',
  user: 'User',
};

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  // Dialog states
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState({
    telegram_first_name: '',
    telegram_last_name: '',
    email: '',
    role: 'user',
    status: 'active',
  });

  // Add form state
  const [addForm, setAddForm] = useState({
    telegram_username: '',
    telegram_first_name: '',
    email: '',
    role: 'user',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);

  // Set/Reset credentials state for existing users
  const [isCredentialsDialogOpen, setIsCredentialsDialogOpen] = useState(false);
  const [credentialsTarget, setCredentialsTarget] = useState<User | null>(null);
  const [credentialsForm, setCredentialsForm] = useState({ email: '', password: '' });
  const [showCredsPassword, setShowCredsPassword] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    try {
      const response = await fetch('/api/users');
      const data = await response.json();
      if (data.success) {
        setUsers(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.telegram_first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.telegram_username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = filterRole === 'all' || user.role === filterRole;
    const matchesStatus = filterStatus === 'all' || user.status === filterStatus;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const getInitials = (name: string | null | undefined) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const stats = {
    total: users.length,
    users: users.filter(u => u.role === 'user').length,
    ibos: users.filter(u => u.role === 'ibo').length,
    admins: users.filter(u => u.role === 'admin').length,
  };

  // View user details
  const handleViewUser = (user: User) => {
    setSelectedUser(user);
    setIsViewDialogOpen(true);
  };

  // Open edit dialog
  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setEditForm({
      telegram_first_name: user.telegram_first_name || '',
      telegram_last_name: user.telegram_last_name || '',
      email: user.email || '',
      role: user.role || 'user',
      status: user.status || 'active',
    });
    setIsEditDialogOpen(true);
  };

  // Save edit
  const handleSaveEdit = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      const data = await response.json();
      if (data.success) {
        await fetchUsers();
        setIsEditDialogOpen(false);
        setSelectedUser(null);
      } else {
        alert('Error updating user: ' + data.error);
      }
    } catch (error) {
      console.error('Error updating user:', error);
      alert('Error updating user');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle suspend/activate
  const handleToggleStatus = async (user: User) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await response.json();
      if (data.success) {
        await fetchUsers();
      } else {
        alert('Error updating status: ' + data.error);
      }
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Error updating status');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open delete dialog
  const handleDeleteClick = (user: User) => {
    setSelectedUser(user);
    setIsDeleteDialogOpen(true);
  };

  // Confirm delete
  const handleConfirmDelete = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (data.success) {
        await fetchUsers();
        setIsDeleteDialogOpen(false);
        setSelectedUser(null);
      } else {
        alert('Error deleting user: ' + data.error);
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('Error deleting user');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add new user
  const handleAddUser = async () => {
    if (!addForm.telegram_first_name) {
      alert('Name is required');
      return;
    }
    if (addForm.password && !addForm.email) {
      alert('Email is required to set a password');
      return;
    }
    if (addForm.password && addForm.password.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });

      const data = await response.json();
      if (data.success) {
        await fetchUsers();
        // If password was set, show credentials so admin can share them
        if (addForm.password && addForm.email) {
          setCreatedCredentials({ email: addForm.email, password: addForm.password });
        } else {
          setIsAddDialogOpen(false);
        }
        setAddForm({
          telegram_username: '',
          telegram_first_name: '',
          email: '',
          role: 'user',
          password: '',
        });
      } else {
        alert('Error adding user: ' + data.error);
      }
    } catch (error) {
      console.error('Error adding user:', error);
      alert('Error adding user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    setAddForm({ ...addForm, password: pwd });
    setShowPassword(true);
  };

  const generateCredsPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    setCredentialsForm({ ...credentialsForm, password: pwd });
    setShowCredsPassword(true);
  };

  const openCredentialsDialog = (user: User) => {
    setCredentialsTarget(user);
    setCredentialsForm({ email: user.email || '', password: '' });
    setShowCredsPassword(false);
    setIsCredentialsDialogOpen(true);
  };

  const handleSetCredentials = async () => {
    if (!credentialsTarget) return;
    if (!credentialsForm.email || !credentialsForm.password) {
      alert('Email and password required');
      return;
    }
    if (credentialsForm.password.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/users/${credentialsTarget.id}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentialsForm),
      });
      const data = await res.json();
      if (data.success) {
        await fetchUsers();
        setIsCredentialsDialogOpen(false);
        setCreatedCredentials({ email: credentialsForm.email, password: credentialsForm.password });
        setCredentialsTarget(null);
      } else {
        alert('Error: ' + (data.error || 'Failed to set credentials'));
      }
    } catch (error) {
      console.error('Error setting credentials:', error);
      alert('Error setting credentials');
    } finally {
      setIsSubmitting(false);
    }
  };

  const sendWhatsAppMessage = (user: User) => {
    if (!user.phone) {
      alert('User has no phone number on file');
      return;
    }
    // Strip non-digit characters from phone (wa.me wants only digits with country code)
    const cleanPhone = user.phone.replace(/\D/g, '');
    const message = encodeURIComponent(
      `Hi ${user.telegram_first_name || ''}, this is a reminder from PayManager.`
    );
    window.open(`https://wa.me/${cleanPhone}?text=${message}`, '_blank');
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
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted-foreground">
            Manage users, IBOs and administrators
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="h-4 w-4" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
              <DialogDescription>
                Add a new user manually or share the bot link for them to register.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="add_name">Full Name *</Label>
                <Input
                  id="add_name"
                  placeholder="User's name"
                  value={addForm.telegram_first_name}
                  onChange={(e) => setAddForm({ ...addForm, telegram_first_name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="add_telegram">Telegram Username</Label>
                <Input
                  id="add_telegram"
                  placeholder="username (without @)"
                  value={addForm.telegram_username}
                  onChange={(e) => setAddForm({ ...addForm, telegram_username: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="add_email">Email (required for web login)</Label>
                <Input
                  id="add_email"
                  type="email"
                  placeholder="email@example.com"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="add_role">Role</Label>
                <Select
                  value={addForm.role}
                  onValueChange={(value) => setAddForm({ ...addForm, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="ibo">IBO</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2 border-t pt-4">
                <Label htmlFor="add_password">Password (optional — for web login)</Label>
                <div className="flex gap-2">
                  <Input
                    id="add_password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Leave empty if user only uses Telegram"
                    value={addForm.password}
                    onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                    className="font-mono"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowPassword(s => !s)}>
                    {showPassword ? 'Hide' : 'Show'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={generatePassword}>
                    Generate
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Set a password for users who don&apos;t use Telegram. They will log in at /login with email + password.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddUser} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add User
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Credentials Display Dialog (shown after creating user with password) */}
        <Dialog
          open={createdCredentials !== null}
          onOpenChange={(open) => {
            if (!open) {
              setCreatedCredentials(null);
              setIsAddDialogOpen(false);
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>✓ User Created — Share These Credentials</DialogTitle>
              <DialogDescription>
                Send the user this email + password so they can log in at the website.
                <span className="block mt-2 text-yellow-700 dark:text-yellow-400 font-medium">
                  ⚠️ This password won&apos;t be shown again — copy it now.
                </span>
              </DialogDescription>
            </DialogHeader>
            {createdCredentials && (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Email</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input value={createdCredentials.email} readOnly className="font-mono" />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(createdCredentials.email)}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Password</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input value={createdCredentials.password} readOnly className="font-mono" />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(createdCredentials.password)}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Login URL</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      value={typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login'}
                      readOnly
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/login`)}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => {
                    const text = `Login at: ${window.location.origin}/login\nEmail: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`;
                    navigator.clipboard.writeText(text);
                    alert('All credentials copied!');
                  }}
                >
                  Copy All
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => { setCreatedCredentials(null); setIsAddDialogOpen(false); }}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, username or email..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Select value={filterRole} onValueChange={setFilterRole}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="user">Users</SelectItem>
                  <SelectItem value="ibo">IBOs</SelectItem>
                  <SelectItem value="admin">Admins</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon">
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">No users registered</p>
              <p className="text-sm">Users will appear here when they register via Telegram</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/10 text-primary text-sm">
                            {getInitials(user.telegram_first_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">
                            {user.telegram_first_name} {user.telegram_last_name || ''}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {user.telegram_username ? `@${user.telegram_username}` : 'No username'}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.role === 'admin' ? 'default' : user.role === 'ibo' ? 'secondary' : 'outline'}>
                        {roleLabels[user.role] || user.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.email || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[user.status] || statusColors.inactive}>
                        {statusLabels[user.status] || user.status}
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
                          <DropdownMenuItem onClick={() => handleViewUser(user)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEditUser(user)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openCredentialsDialog(user)}>
                            <KeyRound className="mr-2 h-4 w-4" />
                            {user.auth_user_id ? 'Reset Password' : 'Set Login Credentials'}
                          </DropdownMenuItem>
                          {user.phone && (
                            <DropdownMenuItem onClick={() => sendWhatsAppMessage(user)}>
                              <MessageCircle className="mr-2 h-4 w-4" />
                              Send WhatsApp
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {user.status === 'active' ? (
                            <DropdownMenuItem
                              className="text-yellow-600"
                              onClick={() => handleToggleStatus(user)}
                            >
                              <Ban className="mr-2 h-4 w-4" />
                              Suspend
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              className="text-green-600"
                              onClick={() => handleToggleStatus(user)}
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              Activate
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDeleteClick(user)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.users}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              IBOs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.ibos}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Admins
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.admins}</p>
          </CardContent>
        </Card>
      </div>

      {/* View Details Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="bg-primary/10 text-primary text-xl">
                    {getInitials(selectedUser.telegram_first_name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-lg font-semibold">
                    {selectedUser.telegram_first_name} {selectedUser.telegram_last_name || ''}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={selectedUser.role === 'admin' ? 'default' : selectedUser.role === 'ibo' ? 'secondary' : 'outline'}>
                      {roleLabels[selectedUser.role] || selectedUser.role}
                    </Badge>
                    <Badge className={statusColors[selectedUser.status] || statusColors.inactive}>
                      {statusLabels[selectedUser.status] || selectedUser.status}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-lg bg-muted p-4">
                <div className="flex items-center gap-3">
                  <AtSign className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Telegram Username</p>
                    <p className="font-medium">
                      {selectedUser.telegram_username ? `@${selectedUser.telegram_username}` : 'Not set'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="font-medium">{selectedUser.email || 'Not set'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Telegram ID</p>
                    <p className="font-mono text-sm">{selectedUser.telegram_id || 'Not set'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Registered</p>
                    <p className="font-medium">
                      {selectedUser.created_at
                        ? format(new Date(selectedUser.created_at), 'MMM d, yyyy HH:mm')
                        : 'Unknown'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>
              Close
            </Button>
            <Button onClick={() => {
              setIsViewDialogOpen(false);
              if (selectedUser) handleEditUser(selectedUser);
            }}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_first_name">First Name</Label>
              <Input
                id="edit_first_name"
                value={editForm.telegram_first_name}
                onChange={(e) => setEditForm({ ...editForm, telegram_first_name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_last_name">Last Name</Label>
              <Input
                id="edit_last_name"
                value={editForm.telegram_last_name}
                onChange={(e) => setEditForm({ ...editForm, telegram_last_name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_email">Email</Label>
              <Input
                id="edit_email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit_role">Role</Label>
                <Select
                  value={editForm.role}
                  onValueChange={(value) => setEditForm({ ...editForm, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="ibo">IBO</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_status">Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(value) => setEditForm({ ...editForm, status: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set/Reset Login Credentials Dialog */}
      <Dialog open={isCredentialsDialogOpen} onOpenChange={setIsCredentialsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {credentialsTarget?.auth_user_id ? 'Reset Password' : 'Set Login Credentials'}
            </DialogTitle>
            <DialogDescription>
              {credentialsTarget?.auth_user_id
                ? 'Update the password for this user. They can keep using Telegram too.'
                : 'Add web login credentials so this user can access the dashboard from a browser.'}
              {credentialsTarget?.telegram_username && (
                <span className="block mt-1 text-xs">
                  ✓ Will keep their Telegram access (@{credentialsTarget.telegram_username})
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="creds_email">Email *</Label>
              <Input
                id="creds_email"
                type="email"
                placeholder="email@example.com"
                value={credentialsForm.email}
                onChange={(e) => setCredentialsForm({ ...credentialsForm, email: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="creds_password">Password *</Label>
              <div className="flex gap-2">
                <Input
                  id="creds_password"
                  type={showCredsPassword ? 'text' : 'password'}
                  placeholder="At least 6 characters"
                  value={credentialsForm.password}
                  onChange={(e) => setCredentialsForm({ ...credentialsForm, password: e.target.value })}
                  className="font-mono"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCredsPassword(s => !s)}>
                  {showCredsPassword ? 'Hide' : 'Show'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={generateCredsPassword}>
                  Generate
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCredentialsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSetCredentials} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {credentialsTarget?.auth_user_id ? 'Reset Password' : 'Create Credentials'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <strong>{selectedUser?.telegram_first_name}</strong>? This action cannot be undone.
              All their accounts and payments will also be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isSubmitting}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
