'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Check, ChevronDown, Loader2, Pencil, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { UserPicker, type UserLike } from '@/components/UserPicker';

// Quick, in-place controls for an account's status and assigned user. Used
// on Accounts, Due Payments and Payments so neither needs the full Edit
// dialog for the two changes that happen most.

export type AccountStatus = 'production' | 'nesting' | 'active' | 'drop' | 'not_in_project';

export const ACCOUNT_STATUS: Record<AccountStatus, { label: string; className: string }> = {
  production: { label: 'Production', className: 'bg-green-100 text-green-800 border-green-300 hover:bg-green-200' },
  nesting: { label: 'Nesting', className: 'bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200' },
  active: { label: 'Active', className: 'bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200' },
  drop: { label: 'Drop', className: 'bg-red-100 text-red-800 border-red-300 hover:bg-red-200' },
  not_in_project: { label: 'No Project', className: 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200' },
};
const STATUS_ORDER: AccountStatus[] = ['production', 'nesting', 'active', 'drop', 'not_in_project'];

async function patchAccount(accountId: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`/api/accounts/${accountId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!json.success) {
    toast.error(json.error || 'Update failed');
    return false;
  }
  return true;
}

/** The status badge, clickable: pick a new status from a menu and it's saved. */
export function StatusQuickPick({ accountId, status, onChanged, size = 'sm' }: { accountId: string; status: string; onChanged: () => void | Promise<void>; size?: 'sm' | 'xs' }) {
  const [busy, setBusy] = useState(false);
  // Shown value updates on success even if the parent's data is refreshed later.
  const [current, setCurrent] = useState(status);
  useEffect(() => setCurrent(status), [status]);
  const cfg = ACCOUNT_STATUS[current as AccountStatus] || { label: current, className: 'bg-gray-100 text-gray-800 border-gray-300' };
  const change = async (next: AccountStatus) => {
    if (next === current) return;
    setBusy(true);
    try {
      if (await patchAccount(accountId, { status: next })) {
        setCurrent(next);
        toast.success(`Status → ${ACCOUNT_STATUS[next].label}`);
        await onChanged();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()} disabled={busy} title="Change status" className="inline-flex items-center">
          <Badge variant="outline" className={`cursor-pointer gap-1 ${size === 'xs' ? 'text-[11px] px-1.5' : ''} ${cfg.className}`}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {cfg.label}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {STATUS_ORDER.map((s) => (
          <DropdownMenuItem key={s} onClick={() => change(s)} className="gap-2">
            <span className={`h-2.5 w-2.5 rounded-full border ${ACCOUNT_STATUS[s].className.split(' ')[0]}`} />
            {ACCOUNT_STATUS[s].label}
            {s === current && <Check className="h-3.5 w-3.5 ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Users are the same for every picker on a page — load once per session.
let usersCache: UserLike[] | null = null;
let usersPromise: Promise<UserLike[]> | null = null;
async function loadAssignableUsers(): Promise<UserLike[]> {
  if (usersCache) return usersCache;
  if (!usersPromise) {
    usersPromise = fetch('/api/users')
      .then((r) => r.json())
      .then((j) => {
        // Users, IBOs and partners can all hold accounts; only admins are excluded.
        const list = ((j.success ? j.data : []) as (UserLike & { role?: string })[]).filter((u) => u.role !== 'admin');
        usersCache = list;
        return list;
      })
      .catch(() => []);
  }
  return usersPromise;
}

const initials = (name: string | null | undefined) =>
  (name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/**
 * Who the account is assigned to, clickable: opens a searchable user list
 * and saves on pick. Shows "Unassigned" (with an invite to assign) when empty.
 */
export function AssignQuickPick({
  accountId,
  accountName,
  userId,
  userName,
  onChanged,
  compact = false,
}: {
  accountId: string;
  accountName?: string;
  userId: string | null | undefined;
  /** Display name if the page already has it; otherwise resolved from the users list */
  userName?: string | null;
  onChanged: () => void | Promise<void>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<UserLike[]>(usersCache || []);
  // Shown assignment; updates on success even if the parent refreshes later.
  const [current, setCurrent] = useState<{ id: string | null; name: string | null }>({ id: userId || null, name: userName ?? null });
  const [picked, setPicked] = useState<string>(userId || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadAssignableUsers().then(setUsers);
  }, []);
  useEffect(() => {
    setCurrent({ id: userId || null, name: userName ?? null });
    setPicked(userId || '');
  }, [userId, userName]);
  const resolved = current.name ?? users.find((u) => u.id === current.id)?.telegram_first_name ?? null;
  const role = users.find((u) => u.id === current.id)?.role;

  const save = async () => {
    setBusy(true);
    try {
      if (await patchAccount(accountId, { user_id: picked || null })) {
        const name = users.find((u) => u.id === picked)?.telegram_first_name || null;
        setCurrent({ id: picked || null, name });
        toast.success(picked ? `Assigned to ${name || 'user'}` : 'Unassigned');
        setOpen(false);
        await onChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`group inline-flex items-center gap-2 rounded-md text-left hover:bg-muted ${compact ? 'px-1.5 py-0.5' : 'px-1.5 py-1 -mx-1.5'}`}
        title={current.id ? 'Change assignment' : 'Assign a user'}
      >
        {current.id ? (
          <>
            {!compact && (
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/10 text-primary text-xs">{initials(resolved)}</AvatarFallback>
              </Avatar>
            )}
            <span className="min-w-0">
              <span className={`block font-medium ${compact ? 'text-xs' : 'text-sm'} truncate`}>{resolved || 'User'}</span>
              {!compact && <span className="block text-xs text-muted-foreground">{role === 'ibo' ? 'IBO' : 'User'}</span>}
            </span>
          </>
        ) : (
          <span className={`inline-flex items-center gap-1 ${compact ? 'text-xs' : 'text-sm'} text-amber-700 font-medium`}>
            <UserPlus className="h-3.5 w-3.5" /> Unassigned
          </span>
        )}
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
      </button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Assign {accountName ? `“${accountName}”` : 'account'}</DialogTitle>
            <DialogDescription>The assigned user sees this account in the app and reports its payments.</DialogDescription>
          </DialogHeader>
          <UserPicker users={users} value={picked} onChange={setPicked} noneLabel="Unassigned" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy || picked === (current.id || '')} className="gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {picked ? 'Assign' : 'Unassign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
