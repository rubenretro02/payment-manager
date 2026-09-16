'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search } from 'lucide-react';

export interface UserLike {
  id: string;
  telegram_first_name: string | null;
  telegram_last_name?: string | null;
  telegram_username: string | null;
  email?: string | null;
  role?: string;
}

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', ibo: 'IBO', partner: 'Partner', user: 'User' };

/**
 * Searchable user list rendered INLINE (no floating dropdown), so on a phone
 * the search box never ends up hidden behind the list. Two columns: name and
 * Telegram username.
 */
export function UserPicker({
  users,
  value,
  onChange,
  noneLabel,
}: {
  users: UserLike[];
  value: string;
  onChange: (id: string) => void;
  /** When set, a first row with this label selects '' (e.g. "Unassigned"). */
  noneLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase().replace(/^@/, '');
  const list = q
    ? users.filter((u) =>
        [u.telegram_first_name, u.telegram_last_name, u.telegram_username, u.email].some((f) => (f || '').toLowerCase().includes(q))
      )
    : users;
  const selected = users.find((u) => u.id === value);
  const fullName = (u: UserLike) => `${u.telegram_first_name || ''} ${u.telegram_last_name || ''}`.trim() || '—';

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="relative border-b">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, @username or email…"
          className="border-0 pl-9 rounded-none focus-visible:ring-0"
        />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/50 border-b">
        <span>Name</span>
        <span>Telegram</span>
      </div>
      <div className="max-h-60 overflow-y-auto divide-y">
        {noneLabel !== undefined && (
          <button
            type="button"
            onClick={() => onChange('')}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${!value ? 'bg-primary/10 font-medium' : ''}`}
          >
            {noneLabel}
          </button>
        )}
        {list.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground text-center">No matches</p>}
        {list.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => onChange(u.id)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-muted grid grid-cols-[1fr_auto] gap-2 items-center ${value === u.id ? 'bg-primary/10 font-medium' : ''}`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="truncate">{fullName(u)}</span>
              {u.role && u.role !== 'user' && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{ROLE_LABEL[u.role] || u.role}</Badge>
              )}
            </span>
            <span className={`font-mono text-xs truncate max-w-[45vw] sm:max-w-[220px] ${u.telegram_username ? 'text-blue-600' : 'text-muted-foreground'}`}>
              {u.telegram_username ? `@${u.telegram_username}` : 'no username'}
            </span>
          </button>
        ))}
      </div>
      <p className="px-3 py-1.5 text-xs text-muted-foreground border-t bg-muted/40">
        {selected ? `Selected: ${fullName(selected)}${selected.telegram_username ? ` · @${selected.telegram_username}` : ''}` : noneLabel !== undefined ? `Selected: ${noneLabel}` : 'Nothing selected'}
      </p>
    </div>
  );
}
