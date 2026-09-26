import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-mono text-xs font-semibold tracking-[0.04em] transition-colors disabled:pointer-events-none disabled:opacity-50 rounded-none',
  {
    variants: {
      variant: {
        primary: 'bg-cobalt text-white border border-structure hover:bg-structure',
        ghost: 'border border-structure bg-transparent text-ink hover:bg-structure hover:text-canvas',
        solid: 'bg-ink text-canvas border border-structure hover:bg-structure',
        outline: 'border border-structure/40 bg-surface text-ink hover:border-structure',
      },
      size: {
        sm: 'px-3 py-1.5',
        md: 'px-5 py-3',
        lg: 'px-6 py-3.5 text-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = 'Button';
