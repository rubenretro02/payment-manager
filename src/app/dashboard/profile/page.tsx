'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  User,
  LogOut,
  Shield,
  Building2,
  CreditCard,
  Bell,
  Settings,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

export default function ProfilePage() {
  const { user, logout, isLoading } = useAuth();

  const getInitials = () => {
    if (!user) return 'U';
    const first = user.telegram_first_name?.[0] || '';
    const last = user.telegram_last_name?.[0] || '';
    return (first + last).toUpperCase() || 'U';
  };

  const getRoleBadge = () => {
    switch (user?.role) {
      case 'admin':
        return <Badge className="bg-red-500">Admin</Badge>;
      case 'ibo':
        return <Badge className="bg-blue-500">IBO</Badge>;
      default:
        return <Badge variant="secondary">User</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isAdmin = user?.role === 'admin' || user?.role === 'ibo';

  // Menu items for admins
  const adminMenuItems = [
    { href: '/dashboard/accounts', label: 'Manage Accounts', icon: Building2 },
    { href: '/dashboard/payment-methods', label: 'Payment Methods', icon: CreditCard },
    { href: '/dashboard/platforms', label: 'Platforms', icon: Settings },
    { href: '/dashboard/projects', label: 'Projects', icon: Settings },
  ];

  return (
    <div className="space-y-6 animate-in pb-20">
      {/* Header */}
      <div className="text-center">
        <Avatar className="h-20 w-20 mx-auto mb-4">
          <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
            {getInitials()}
          </AvatarFallback>
        </Avatar>
        <h1 className="text-xl font-bold">
          {user?.telegram_first_name} {user?.telegram_last_name}
        </h1>
        {user?.telegram_username && (
          <p className="text-muted-foreground">@{user.telegram_username}</p>
        )}
        <div className="mt-2 flex justify-center gap-2">
          {getRoleBadge()}
        </div>
      </div>

      {/* User Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="h-5 w-5" />
            Account Info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Role</span>
            <span className="font-medium capitalize">{user?.role || 'User'}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Status</span>
            <Badge variant="outline" className="capitalize">
              {user?.status || 'Active'}
            </Badge>
          </div>
          {user?.email && (
            <>
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium">{user.email}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Admin Menu */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Admin Settings
            </CardTitle>
            <CardDescription>Manage your business</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {adminMenuItems.map((item, index) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <item.icon className="h-5 w-5 text-muted-foreground" />
                  <span>{item.label}</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Logout Button */}
      <Card className="border-red-200 dark:border-red-900">
        <CardContent className="p-4">
          <Button
            variant="destructive"
            className="w-full gap-2"
            onClick={logout}
          >
            <LogOut className="h-4 w-4" />
            Log Out
          </Button>
        </CardContent>
      </Card>

      {/* App Info */}
      <div className="text-center text-xs text-muted-foreground">
        <p>Payment Manager v1.0</p>
        <p>© 2024 All rights reserved</p>
      </div>
    </div>
  );
}
