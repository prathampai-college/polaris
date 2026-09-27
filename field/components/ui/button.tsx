import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Every size floors at --tap (44px, 56px in glove mode).
export const buttonVariants = cva(
  'inline-flex min-h-tap items-center justify-center gap-2 whitespace-nowrap border font-mono text-sm font-semibold tracking-[0.04em] transition-colors select-none disabled:pointer-events-none disabled:opacity-40 active:translate-x-px active:translate-y-px',
  {
    variants: {
      variant: {
        primary: 'border-structure bg-cobalt text-white hover:bg-structure hover:text-canvas',
        solid: 'border-structure bg-ink text-canvas hover:bg-structure',
        ghost: 'border-structure bg-transparent text-ink hover:bg-structure hover:text-canvas',
        outline: 'border-structure/40 bg-surface text-ink hover:border-structure',
        danger: 'border-structure bg-flare text-white hover:bg-structure hover:text-canvas',
        quiet: 'border-transparent bg-transparent text-slate hover:text-ink',
      },
      size: {
        sm: 'px-3 text-xs',
        md: 'px-4',
        lg: 'px-6 text-base',
        icon: 'min-w-tap px-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';
