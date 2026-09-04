'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Eye } from 'lucide-react';
import type { Wallet } from '@/lib/types';
import { shortAddress } from '@/lib/wallets/networks';

interface Props {
  wallets: Wallet[];
  value: string;
  onChange: (id: string) => void;
  allowNone?: boolean;
  noneLabel?: string;
  placeholder?: string;
  maxHeight?: string;
}

// Searchable wallet list: matches name, address, assigned account, user or
// seed name. Replaces the plain Select, which was unusable with 100+ wallets.
export function WalletPicker({ wallets, value, onChange, allowNone = false, noneLabel = 'None', placeholder = 'Search wallet, account or user…', maxHeight = 'max-h-56' }: Props) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = q
    ? wallets.filter((w) => {
        const hay = [
          w.name,
          w.address,
          w.seed_name,
          ...(w.assigned_accounts || []).flatMap((a) => [a.full_name, a.user_name]),
        ];
        return hay.some((s) => !!s && s.toLowerCase().includes(q));
      })
    : wallets;
  const selected = wallets.find((w) => w.id === value);

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="relative border-b">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} className="border-0 pl-9 rounded-none focus-visible:ring-0" />
      </div>
      <div className={`${maxHeight} overflow-y-auto divide-y`}>
        {allowNone && (
          <button type="button" onClick={() => onChange('')} className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${!value ? 'bg-primary/10 font-medium' : ''}`}>
            {noneLabel}
          </button>
        )}
        {list.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground text-center">No matches</p>}
        {list.map((w) => {
          const acct = (w.assigned_accounts || []).map((a) => `${a.full_name}${a.user_name ? ` · ${a.user_name}` : ''}`).join(', ');
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => onChange(w.id)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between gap-2 ${value === w.id ? 'bg-primary/10 font-medium' : ''}`}
            >
              <span className="min-w-0">
                <span className="truncate block">
                  {w.name || shortAddress(w.address)}
                  {w.source === 'watch' && <Eye className="inline h-3 w-3 ml-1 text-amber-700" />}
                </span>
                <span className="text-[11px] text-muted-foreground font-mono truncate block">
                  {shortAddress(w.address)}{acct ? ` → ${acct}` : ''}
                </span>
              </span>
              <Badge variant="outline" className="text-[10px] shrink-0">{w.chain_family === 'solana' ? 'Solana' : 'EVM'}</Badge>
            </button>
          );
        })}
      </div>
      {selected && (
        <p className="px-3 py-1.5 text-xs text-muted-foreground border-t bg-muted/40 truncate">
          Selected: {selected.name || shortAddress(selected.address)} · {shortAddress(selected.address)}
        </p>
      )}
    </div>
  );
}
