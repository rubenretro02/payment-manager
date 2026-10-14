'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Copy, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { acceptedNetworks, getNetwork } from '@/lib/wallets/networks';

/**
 * Scannable QR of a wallet address, for sending to it from an exchange or
 * another wallet. Encodes the bare address (what every wallet / exchange
 * scanner expects), shows it in full for eye-checking, and lists the
 * networks it is valid on so nobody sends on the wrong chain.
 */
export function AddressQrDialog({
  open,
  onClose,
  address,
  name,
  network,
  family,
}: {
  open: boolean;
  onClose: () => void;
  address: string;
  name?: string | null;
  network: string;
  family: 'evm' | 'solana';
}) {
  const [copied, setCopied] = useState(false);
  const nets = family === 'evm' ? acceptedNetworks(network).map((n) => n.label) : [getNetwork(network)?.label || 'Solana'];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy');
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> {name || 'Wallet'}</DialogTitle>
          <DialogDescription>Scan to send to this wallet. {family === 'evm' ? 'Same address on every EVM network listed below.' : 'Solana only.'}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-xl bg-white p-4 shadow-sm border">
            <QRCodeSVG value={address} size={220} level="M" includeMargin={false} />
          </div>
          <button type="button" onClick={copy} className="w-full rounded-lg border bg-muted/50 px-3 py-2 text-left font-mono text-[12px] break-all hover:bg-muted" title="Copy address">
            {address}
          </button>
          <Button variant="outline" size="sm" onClick={copy} className="gap-2 w-full">
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy address'}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Valid on: <b>{nets.join(' · ')}</b>. Sending on any other network loses the funds.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
