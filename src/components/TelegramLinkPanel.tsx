'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Link2, Copy, Check, RefreshCw, Loader2, MessageCircle, QrCode, X } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface LinkInfo {
  url: string;
  bot: string;
  expires_at: string;
}

/**
 * "Link this user to Telegram": a one-time invite link + its QR. The user
 * opens it in Telegram, presses Start, and the bot attaches their Telegram
 * to this record. Works even if we don't know their @username.
 */
export function TelegramLinkPanel({ userId, userName, phone }: { userId: string; userName?: string | null; phone?: string | null }) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async (renew = false) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${userId}/telegram-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ renew }) });
      const json = await res.json();
      if (!json.success) return toast.error(json.error || 'Could not create the link');
      setInfo(json.data);
      if (renew) toast.success('New link generated — the old one no longer works');
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy');
    }
  };
  const shareText = (url: string) =>
    `Hi${userName ? ` ${userName}` : ''}! Open this link in Telegram and press Start to activate your Payment Manager access:\n${url}`;
  const waHref = info ? `https://wa.me/${(phone || '').replace(/[^\d]/g, '')}?text=${encodeURIComponent(shareText(info.url))}` : '#';

  if (!info) {
    return (
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 text-xs text-blue-800 dark:text-blue-300 space-y-2">
        <p>💡 <strong>Link this user to Telegram:</strong> generate an invite link and send it (or let them scan the QR). When they open it and press Start, their Telegram gets attached to this account. Email login keeps working.</p>
        <Button type="button" size="sm" onClick={() => load(false)} disabled={busy} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Get link & QR
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-2"><QrCode className="h-4 w-4" /> Telegram invite</p>
        <button type="button" onClick={() => setInfo(null)} className="text-muted-foreground hover:text-foreground" title="Hide"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-center sm:items-start">
        <div className="rounded-lg bg-white p-2 border shrink-0">
          <QRCodeSVG value={info.url} size={150} level="M" />
        </div>
        <div className="flex-1 min-w-0 space-y-2 w-full">
          <button type="button" onClick={copy} className="w-full rounded-md border bg-white dark:bg-background px-2 py-1.5 text-left text-[12px] font-mono break-all hover:bg-muted" title="Copy link">
            {info.url}
          </button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={copy} className="gap-1">
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button type="button" size="sm" variant="outline" asChild className="gap-1">
              <a href={waHref} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" /> {phone ? 'Send on WhatsApp' : 'Share on WhatsApp'}</a>
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => load(true)} disabled={busy} className="gap-1" title="Invalidate this link and make a new one">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} New link
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Bot @{info.bot} · one use · expires {format(new Date(info.expires_at), 'MMM d, yyyy')}. The user opens the link, presses <b>Start</b>, done.
          </p>
        </div>
      </div>
    </div>
  );
}
