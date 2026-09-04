'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
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
  CalendarClock,
  BarChart3,
  Layers,
  UserCircle,
  MoreHorizontal,
  LogOut,
  Wallet,
  Inbox,
  ArrowLeftRight,
  BookUser,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

// Navigation items for regular users
const userNavItems = [
  { href: '/dashboard/my-accounts', label: 'Accounts', icon: Building2 },
  { href: '/dashboard/my-payments', label: 'Payments', icon: History },
  { href: '/dashboard/payment-info', label: 'Pay Methods', icon: CreditCard },
  { href: '/dashboard/profile', label: 'Profile', icon: User },
];

// Partner = regular user flow (my-accounts/my-payments) + semi-admin views
// scoped to the accounts they own (owner_id).
const partnerBottomItems = [
  { href: '/dashboard/my-accounts', label: 'My Accts', icon: Building2 },
  { href: '/dashboard/payments', label: 'Payments', icon: CreditCard },
  { href: '/dashboard/reports', label: 'Reports', icon: BarChart3 },
];

const partnerMoreItems = [
  { href: '/dashboard/my-accounts', label: 'My Accounts', icon: Building2 },
  { href: '/dashboard/my-payments', label: 'My Payments', icon: History },
  { href: '/dashboard/accounts', label: 'Accounts', icon: Building2 },
  { href: '/dashboard/payments', label: 'Payments', icon: CreditCard },
  { href: '/dashboard/reports', label: 'Reports', icon: BarChart3 },
  { href: '/dashboard/payment-info', label: 'Pay Methods', icon: CreditCard },
  { href: '/dashboard/profile', label: 'Profile', icon: User },
];

// Bottom bar — 3 most-used + More opener
const adminBottomItems = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/dashboard/due-payments', label: 'Due', icon: CalendarClock },
  { href: '/dashboard/payments', label: 'Payments', icon: CreditCard },
];

// Full menu — everything else admin can reach from mobile
const adminMoreItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/due-payments', label: 'Due Payments', icon: CalendarClock },
  { href: '/dashboard/payments', label: 'Payments', icon: CreditCard },
  { href: '/dashboard/reports', label: 'Reports', icon: BarChart3 },
  { href: '/dashboard/users', label: 'Users', icon: Users },
  { href: '/dashboard/accounts', label: 'Accounts', icon: Building2 },
  { href: '/dashboard/wallets', label: 'Wallets', icon: Wallet },
  { href: '/dashboard/wallets/deposits', label: 'Wallet Deposits', icon: Inbox },
  { href: '/dashboard/wallets/transfers', label: 'Wallet Transfers', icon: ArrowLeftRight },
  { href: '/dashboard/wallets/book', label: 'Address Book', icon: BookUser },
  { href: '/dashboard/wallets/settings', label: 'Wallet Settings', icon: Settings },
  { href: '/dashboard/platforms', label: 'Platforms', icon: Layers },
  { href: '/dashboard/projects', label: 'Projects', icon: UserCircle },
  { href: '/dashboard/payment-methods', label: 'Payment Methods', icon: CreditCard },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  { href: '/dashboard/profile', label: 'Profile', icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'ibo';
  const isPartner = user?.role === 'partner';
  const bottomItems = isPartner ? partnerBottomItems : adminBottomItems;
  const moreItems = isPartner ? partnerMoreItems : adminMoreItems;

  const isActive = (href: string) =>
    href === '/dashboard'
      ? pathname === '/dashboard'
      : pathname === href || pathname.startsWith(href + '/');

  if (!isAdmin && !isPartner) {
    // Regular users keep their original bottom nav
    return (
      <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-bottom">
        <div className="flex items-center justify-around h-16">
          {userNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors',
                isActive(item.href) ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <item.icon className={cn('h-5 w-5', isActive(item.href) && 'text-primary')} />
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    );
  }

  // Admin / IBO / Partner: 3 quick links + More menu
  return (
    <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-bottom">
      <div className="flex items-center justify-around h-16">
        {bottomItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors',
              isActive(item.href) ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <item.icon className={cn('h-5 w-5', isActive(item.href) && 'text-primary')} />
            <span className="text-xs font-medium">{item.label}</span>
          </Link>
        ))}

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors',
                'text-muted-foreground hover:text-foreground'
              )}
            >
              <MoreHorizontal className="h-5 w-5" />
              <span className="text-xs font-medium">More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl">
            <SheetHeader className="text-left">
              <SheetTitle>All Pages</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-3 gap-3 mt-6 pb-6 overflow-y-auto max-h-[calc(85vh-8rem)]">
              {moreItems.map((item) => (
                <button
                  key={item.href}
                  onClick={() => {
                    router.push(item.href);
                    setMoreOpen(false);
                  }}
                  className={cn(
                    'flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all active:scale-95',
                    isActive(item.href)
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'bg-card border-border hover:border-primary/30'
                  )}
                >
                  <item.icon className="h-6 w-6" />
                  <span className="text-xs font-medium text-center leading-tight">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="border-t pt-3 mt-2">
              <Button
                variant="ghost"
                className="w-full justify-start text-destructive gap-3"
                onClick={() => {
                  setMoreOpen(false);
                  logout();
                }}
              >
                <LogOut className="h-5 w-5" />
                Log out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
