'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

export interface AccountLike {
  id: string;
  full_name: string;
  wallet_address: string | null;
  user_name: string | null;
}

// Searchable account list (the plain Select was unusable with 100+ accounts).
export function AccountPicker({
  accounts,
  value,
  onChange,
  allowNone = false,
}: {
  accounts: AccountLike[];
  value: string;
  onChange: (id: string) => void;
  allowNone?: boolean;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = q
    ? accounts.filter((a) => a.full_name.toLowerCase().includes(q) || (a.user_name || '').toLowerCase().includes(q))
    : accounts;
  const selected = accounts.find((a) => a.id === value);
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="relative border-b">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search account or user…"
          className="border-0 pl-9 rounded-none focus-visible:ring-0"
          autoFocus
        />
      </div>
      <div className="max-h-56 overflow-y-auto divide-y">
        {allowNone && (
          <button type="button" onClick={() => onChange('')} className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${!value ? 'bg-primary/10 font-medium' : ''}`}>
            None
          </button>
        )}
        {list.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground text-center">No matches</p>}
        {list.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onChange(a.id)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between gap-2 ${value === a.id ? 'bg-primary/10 font-medium' : ''}`}
          >
            <span className="truncate">
              {a.full_name}
              {a.user_name ? <span className="text-muted-foreground"> · {a.user_name}</span> : null}
            </span>
            {a.wallet_address && <span className="text-[10px] text-muted-foreground shrink-0">has wallet</span>}
          </button>
        ))}
      </div>
      {selected && <p className="px-3 py-1.5 text-xs text-muted-foreground border-t bg-muted/40">Selected: {selected.full_name}</p>}
    </div>
  );
}
