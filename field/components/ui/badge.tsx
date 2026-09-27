import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Status is never colour-only: callers always pass a text label (and ideally an icon).
const badgeVariants = cva('inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-[0.06em]', {
  variants: {
    variant: {
      neutral: 'border-structure/40 bg-canvas text-slate',
      solid: 'border-structure bg-ink text-canvas',
      active: 'border-cobalt bg-cobalt/10 text-cobalt',
      live: 'border-phosphor bg-phosphor/10 text-ink',
      caution: 'border-caution bg-caution/10 text-caution',
      critical: 'border-flare bg-flare/10 text-flare',
      ok: 'border-structure/40 bg-surface text-ink',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Dot({ tone = 'cobalt', pulse }: { tone?: 'cobalt' | 'phosphor' | 'flare' | 'slate' | 'caution'; pulse?: boolean }) {
  const bg = { cobalt: 'bg-cobalt', phosphor: 'bg-phosphor', flare: 'bg-flare', slate: 'bg-slate', caution: 'bg-caution' }[tone];
  return <span aria-hidden className={cn('inline-block h-2 w-2 shrink-0', bg, pulse && 'animate-blink')} />;
}
