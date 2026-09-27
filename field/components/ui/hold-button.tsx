'use client';
import * as React from 'react';
import { cn, haptic } from '../../lib/utils';

/**
 * Press-and-hold to confirm. Glove-friendly and hard to fire by accident — used
 * for SOS and other irreversible field actions instead of a confirm modal.
 * Keyboard: hold Space/Enter.
 */
export function HoldButton({ onConfirm, holdMs = 1500, disabled, className, children, tone = 'flare', label }: {
  onConfirm: () => void;
  holdMs?: number;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  tone?: 'flare' | 'cobalt';
  label: string;
}) {
  const [progress, setProgress] = React.useState(0);
  const raf = React.useRef<number | null>(null);
  const start = React.useRef(0);
  const fired = React.useRef(false);

  const stop = React.useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  }, []);

  const begin = () => {
    if (disabled || raf.current) return;
    fired.current = false;
    start.current = performance.now();
    haptic(20);
    const step = (t: number) => {
      const p = Math.min(1, (t - start.current) / holdMs);
      setProgress(p);
      if (p >= 1) {
        if (!fired.current) { fired.current = true; haptic([60, 40, 120]); onConfirm(); }
        raf.current = null;
        setTimeout(() => setProgress(0), 250);
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  React.useEffect(() => stop, [stop]);

  const fill = tone === 'flare' ? 'bg-flare' : 'bg-cobalt';
  return (
    <button
      type="button"
      aria-label={`${label} — press and hold`}
      disabled={disabled}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); begin(); }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); } }}
      onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') stop(); }}
      className={cn('relative isolate min-h-tap touch-none select-none overflow-hidden border border-structure bg-surface font-mono font-semibold uppercase tracking-[0.08em] text-ink disabled:opacity-40', className)}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 -z-10', fill)} style={{ width: `${progress * 100}%` }} />
      <span className={cn('relative flex items-center justify-center gap-2 px-4', progress > 0.5 && 'text-white')}>{children}</span>
    </button>
  );
}
