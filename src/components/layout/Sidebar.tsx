'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Building2,
  Bell,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  UserCircle,
  Layers,
  BarChart3,
  CalendarClock,
  History,
  Wallet,
  Inbox,
  ArrowLeftRight,
  BookUser,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface NavLink {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  children?: { href: string; label: string; icon: typeof LayoutDashboard }[];
}

// Wallets is a parent section: its sub-pages show indented while you're in it.
const walletChildren = [
  { href: '/dashboard/wallets', label: 'Overview', icon: Wallet },
  { href: '/dashboard/wallets/deposits', label: 'Deposits', icon: Inbox },
  { href: '/dashboard/wallets/transfers', label: 'Transfers', icon: ArrowLeftRight },
  { href: '/dashboard/wallets/book', label: 'Address book', icon: BookUser },
  { href: '/dashboard/wallets/settings', label: 'Settings', icon: Settings },
];

const adminLinks: NavLink[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/users', label: 'Users', icon: Users },
  { href: '/dashboard/due-payments', label: 'Due Payments', icon: CalendarClock },
  { href: '/dashboard/payments', label: 'Payments', icon: CreditCard },
  { href: '/dashboard/reports', label: 'Reports', icon: BarChart3 },
  { href: '/dashboard/accounts', label: 'Accounts', icon: Building2 },
  { href: '/dashboard/wallets', label: 'Wallets', icon: Wallet, children: walletChildren },
  { href: '/dashboard/platforms', label: 'Platforms', icon: Layers },
  { href: '/dashboard/projects', label: 'Projects', icon: UserCircle },
  { href: '/dashboard/payment-methods', label: 'Payment Methods', icon: CreditCard },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

const iboLinks: NavLink[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/users', label: 'My Users', icon: Users },
  { href: '/dashboard/due-payments', label: 'Due Payments', icon: CalendarClock },
  { href: '/dashboard/payments', label: 'Payments', icon: CreditCard },
  { href: '/dashboard/accounts', label: 'My Accounts', icon: Building2 },
];

// Partner = regular user flow (my-accounts/my-payments) + semi-admin views
// scoped to the accounts they own (owner_id).
const partnerLinks: NavLink[] = [
  { href: '/dashboard/my-accounts', label: 'My Accounts', icon: Building2 },
  { href: '/dashboard/my-payments', label: 'My Payments', icon: History },
  { href: '/dashboard/accounts', label: 'Accounts', icon: Building2 },
  { href: '/dashboard/payments', label: 'Payments', icon: CreditCard },
  { href: '/dashboard/reports', label: 'Reports', icon: BarChart3 },
];

const userLinks: NavLink[] = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/dashboard/my-accounts', label: 'My Accounts', icon: Building2 },
  { href: '/dashboard/payments', label: 'My Payments', icon: CreditCard },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuth();

  const links = user?.role === 'admin'
    ? adminLinks
    : user?.role === 'ibo'
      ? iboLinks
      : user?.role === 'partner'
        ? partnerLinks
        : userLinks;

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen border-r bg-card transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b px-4">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <CreditCard className="h-4 w-4" />
              </div>
              <span className="font-semibold">PayManager</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className={cn(collapsed && 'mx-auto')}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-2">
          {links.map((link) => {
            const inSection = link.href !== '/dashboard' && pathname.startsWith(link.href);
            const isActive = pathname === link.href || (inSection && !link.children);

            return (
              <div key={link.href}>
                <Link
                  href={link.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    isActive || (link.children && inSection)
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    collapsed && 'justify-center px-2'
                  )}
                >
                  <link.icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span>{link.label}</span>}
                </Link>
                {link.children && inSection && !collapsed && (
                  <div className="ml-4 mt-1 space-y-0.5 border-l pl-2">
                    {link.children.map((child) => {
                      const childActive = child.href === link.href ? pathname === child.href : pathname.startsWith(child.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                            childActive ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          )}
                        >
                          <child.icon className="h-3.5 w-3.5 shrink-0" />
                          <span>{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t p-2">
          {user && !collapsed && (
            <div className="mb-2 rounded-lg bg-muted p-3">
              <p className="text-sm font-medium">{user.telegram_first_name}</p>
              <p className="text-xs text-muted-foreground uppercase">{user.role}</p>
            </div>
          )}
          <Button
            variant="ghost"
            className={cn(
              'w-full justify-start gap-3 text-muted-foreground hover:text-destructive',
              collapsed && 'justify-center px-2'
            )}
            onClick={logout}
          >
            <LogOut className="h-5 w-5" />
            {!collapsed && <span>Logout</span>}
          </Button>
        </div>
      </div>
    </aside>
  );
}
