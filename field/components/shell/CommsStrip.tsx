'use client';
import Link from 'next/link';
import { Lock, Siren } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useField } from '../../lib/field-context';
import { Dot } from '../ui/badge';
import { ago, cn } from '../../lib/utils';

/** Always-true status line. Every chip reflects real state — nothing here is decorative. */
export function CommsStrip() {
  const { session, stationLabel, sync, outbox, storage, secure, logout, setSosOpen } = useField();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  if (!session) return null;

  const bundled = outbox?.BUNDLED ?? 0;
  const link = {
    live: { label: 'LIVE LINK', tone: 'phosphor' as const, pulse: false },
    connecting: { label: 'CONNECTING', tone: 'slate' as const, pulse: true },
    offline: { label: bundled ? 'DTN STORE-FWD' : 'NO LINK', tone: 'slate' as const, pulse: false },
    key_mismatch: { label: 'KEY MISMATCH', tone: 'flare' as const, pulse: true },
    cut: { label: 'LINK CUT · DRILL', tone: 'caution' as const, pulse: false },
  }[sync.link];

  return (
    <header className="sticky top-0 z-40 border-b border-structure bg-surface">
      <div className="flex min-h-tap items-stretch">
        <Link href="/" className="flex shrink-0 items-center gap-2 border-r border-structure px-3 sm:px-4" aria-label="POLARIS field — brief">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="text-cobalt"><path d="M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z" fill="currentColor" /></svg>
          <span className="hidden font-mono text-sm font-bold tracking-[0.18em] sm:inline">POLARIS</span>
          <span className="font-display text-lg leading-none text-ink">{stationLabel}</span>
        </Link>

        <Link href="/comms" className="flex min-w-0 flex-1 items-center gap-x-4 gap-y-1 overflow-x-auto px-3 font-mono text-xs font-semibold tracking-[0.06em] scroll-thin hover:bg-canvas" aria-label="Link and sync status — open Comms">
          <span className="flex items-center gap-2 whitespace-nowrap"><Dot tone={link.tone} pulse={link.pulse} />{link.label}</span>
          <span className="num whitespace-nowrap text-slate" title="Writes not yet confirmed by HQ">
            <span className={cn((outbox?.unsynced ?? 0) > 0 ? 'text-ink' : 'text-slate')}>{outbox?.unsynced ?? '—'}</span> UNSYNCED
          </span>
          {(outbox?.FAILED ?? 0) > 0 && <span className="whitespace-nowrap text-flare">{outbox!.FAILED} FAILED</span>}
          <span className="hidden whitespace-nowrap text-slate md:inline">ACK {ago(outbox?.lastAckAt).toUpperCase()}</span>
          {storage.state === 'memory' && <span className="whitespace-nowrap bg-flare px-1.5 py-0.5 text-white">EPHEMERAL · LOST ON RELOAD</span>}
          {storage.state === 'fatal' && <span className="whitespace-nowrap bg-flare px-1.5 py-0.5 text-white">STORAGE FAILED</span>}
          {!secure && <span className="whitespace-nowrap text-flare">INSECURE HTTP</span>}
          {sync.devKey && <span className="whitespace-nowrap text-caution">DEV KEY</span>}
          {session.offlineUnlock && <span className="whitespace-nowrap text-slate">OFFLINE UNLOCK</span>}
        </Link>

        <span className="hidden items-center border-l border-structure px-3 font-mono text-xs text-slate lg:flex">{session.role.replace('_', ' ')}</span>
        <button type="button" onClick={() => setSosOpen(true)} className="flex min-w-tap items-center gap-2 border-l border-structure bg-flare px-3 font-mono text-sm font-bold tracking-[0.1em] text-white hover:bg-ink sm:px-4" aria-label="Raise SOS">
          <Siren size={18} aria-hidden /> <span>SOS</span>
        </button>
        <button type="button" onClick={() => logout()} className="grid min-w-tap place-items-center border-l border-structure text-ink hover:bg-structure hover:text-canvas" aria-label="Lock tablet">
          <Lock size={18} />
        </button>
      </div>
    </header>
  );
}
