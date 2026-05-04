'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import {
  Building2,
  CreditCard,
  History,
  LayoutDashboard,
  Users,
  Settings,
  User,
} from 'lucide-react';

// Navigation items for regular users
const userNavItems = [
  { href: '/dashboard/my-accounts', label: 'Accounts', icon: Building2 },
  { href: '/dashboard/my-payments', label: 'Payments', icon: History },
  { href: '/dashboard/payment-info', label: 'Pay Methods', icon: CreditCard },
  { href: '/dashboard/profile', label: 'Profile', icon: User },
];

// Navigation items for admin users
const adminNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/payments', label: 'Payments', icon: CreditCard },
  { href: '/dashboard/users', label: 'Users', icon: Users },
  { href: '/dashboard/profile', label: 'Profile', icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  const isAdmin = user?.role === 'admin' || user?.role === 'ibo';
  const navItems = isAdmin ? adminNavItems : userNavItems;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-bottom">
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const isActive = item.href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <item.icon className={cn('h-5 w-5', isActive && 'text-primary')} />
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
