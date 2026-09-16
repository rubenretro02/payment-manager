'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

/**
 * "@username" as a link to the Telegram profile plus a one-click copy of the
 * handle. Renders a muted "No username" when there is none.
 */
export function TelegramHandle({ username, className = '' }: { username: string | null | undefined; className?: string }) {
  const [copied, setCopied] = useState(false);
  const clean = (username || '').replace(/^@/, '').trim();
  if (!clean) return <span className={`text-sm text-muted-foreground ${className}`}>No username</span>;

  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(`@${clean}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <span className={`inline-flex items-center gap-1 text-sm ${className}`}>
      <a
        href={`https://t.me/${clean}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-blue-600 hover:underline break-all"
        title="Open in Telegram"
      >
        @{clean}
      </a>
      <button
        type="button"
        onClick={copy}
        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
        title="Copy @username"
        aria-label="Copy Telegram username"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}
