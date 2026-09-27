import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1.5 font-mono text-[10px] font-bold px-2 py-0.5 border', {
  variants: {
    variant: {
      neutral: 'border-structure bg-canvas text-slate',
      solid: 'border-structure bg-ink text-canvas',
      active: 'border-cobalt bg-cobalt/10 text-cobalt',
      critical: 'border-flare bg-flare/10 text-flare',
      warning: 'border-amber-300 bg-amber-50 text-amber-700',
      live: 'border-cobalt/30 bg-cobalt/10 text-cobalt',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
