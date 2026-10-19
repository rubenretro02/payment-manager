'use client';

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, ChevronDown, Search, UserX, Users } from 'lucide-react';
import type { UserLike } from '@/components/UserPicker';

/**
 * "Assigned to" filter: a dropdown with a search box inside, because the
 * user list is long. Values: 'all' | 'unassigned' | <user id>.
 */
export function UserFilterDropdown({ users, value, onChange }: { users: UserLike[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase().replace(/^@/, '');
  const list = s
    ? users.filter((u) => [u.telegram_first_name, u.telegram_last_name, u.telegram_username, u.email].some((f) => (f || '').toLowerCase().includes(s)))
    : users;
  const current = users.find((u) => u.id === value);
  const label = value === 'all' ? 'All Users' : value === 'unassigned' ? 'Unassigned' : current?.telegram_first_name || 'User';
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ('');
  };
  const Row = ({ v, children }: { v: string; children: React.ReactNode }) => (
    <button type="button" onClick={() => pick(v)} className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted ${value === v ? 'bg-primary/10 font-medium' : ''}`}>
      {children}
      {value === v && <Check className="h-3.5 w-3.5 ml-auto" />}
    </button>
  );
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(''); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={`justify-between gap-2 font-normal ${value !== 'all' ? 'border-primary text-primary' : ''}`}>
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="relative border-b">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search user…" className="border-0 pl-9 rounded-none focus-visible:ring-0" autoFocus />
        </div>
        <div className="max-h-64 overflow-y-auto divide-y">
          {!s && (
            <>
              <Row v="all"><Users className="h-4 w-4 text-muted-foreground" /> All Users</Row>
              <Row v="unassigned"><UserX className="h-4 w-4 text-amber-600" /> Unassigned</Row>
            </>
          )}
          {list.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground text-center">No matches</p>}
          {list.map((u) => (
            <Row key={u.id} v={u.id}>
              <span className="min-w-0">
                <span className="block truncate">{u.telegram_first_name || '—'}{u.telegram_last_name ? ` ${u.telegram_last_name}` : ''}</span>
                {u.telegram_username && <span className="block text-xs text-muted-foreground">@{u.telegram_username}</span>}
              </span>
            </Row>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
