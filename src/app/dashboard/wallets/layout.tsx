'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wallet as WalletIcon, Inbox, ArrowLeftRight, BookUser, Settings, Lock, Pause, Play, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VaultGate } from '@/components/wallets/VaultGate';
import { WalletsProvider, useWallets } from './_context';

const TABS = [
  { href: '/dashboard/wallets', label: 'Overview', icon: WalletIcon, exact: true },
  { href: '/dashboard/wallets/deposits', label: 'Deposits', icon: Inbox },
  { href: '/dashboard/wallets/transfers', label: 'Transfers', icon: ArrowLeftRight },
  { href: '/dashboard/wallets/book', label: 'Address book', icon: BookUser },
  { href: '/dashboard/wallets/settings', label: 'Settings', icon: Settings },
];

// Wallets is a section with sub-pages; every sub-page shares the vault
// session and data through WalletsProvider and sits behind the VaultGate.
export default function WalletsLayout({ children }: { children: ReactNode }) {
  return (
    <WalletsProvider>
      <Shell>{children}</Shell>
    </WalletsProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, vault, unlocked, seeds, wallets, settings, setAutoPaused } = useWallets();
  const [pausing, setPausing] = useState(false);

  const togglePause = async () => {
    const next = !settings.auto_paused;
    setPausing(true);
    const ok = await setAutoPaused(next);
    setPausing(false);
    if (!ok) return toast.error('Could not change the setting');
    toast.success(
      next
        ? 'Automatic transfers paused. Nothing moves on its own until you resume.'
        : 'Automatic transfers back on. Pending sweeps run on the next check.'
    );
  };

  if (user && user.role !== 'admin') {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">Admins only.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 animate-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <WalletIcon className="h-6 w-6" />
            Wallets
          </h1>
          <p className="text-muted-foreground text-sm">
            Deposit wallets derived from your seed{seeds.length > 1 ? 's' : ''}, across every network
            {unlocked && seeds.length > 0 ? ` · ${seeds.length} seed${seeds.length === 1 ? '' : 's'} · ${wallets.length} wallets` : ''}
          </p>
        </div>
        {unlocked && (
          <div className="flex flex-wrap gap-2 self-start sm:self-auto">
            <Button
              variant="outline"
              onClick={togglePause}
              disabled={pausing}
              className={cn('gap-2', settings.auto_paused && 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200')}
              title="Stops sweeps that run on their own. The Run now buttons keep working."
            >
              {pausing ? <Loader2 className="h-4 w-4 animate-spin" /> : settings.auto_paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {settings.auto_paused ? 'Resume auto-transfers' : 'Pause auto-transfers'}
            </Button>
            <Button variant="outline" onClick={() => vault.lock()} className="gap-2">
              <Lock className="h-4 w-4" />
              Lock
            </Button>
          </div>
        )}
      </div>

      {unlocked && settings.auto_paused && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Automatic transfers are paused. Nothing is swept on unlock or by the watcher, so you can review balances.
          The Run now buttons still send when you ask them to.
        </div>
      )}

      <nav className="-mx-4 lg:-mx-6 px-4 lg:px-6 border-b overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map((t) => {
            const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors',
                  active ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <VaultGate vault={vault}>{children}</VaultGate>
    </div>
  );
}
