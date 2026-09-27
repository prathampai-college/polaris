import * as React from 'react';
import { cn } from '../../lib/utils';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('border border-structure bg-surface', className)} {...props} />
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('border-b border-structure px-4 py-3', className)} {...props} />
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h3 ref={ref} className={cn('font-display text-lg text-ink', className)} {...props} />
);
CardTitle.displayName = 'CardTitle';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-4', className)} {...props} />
);
CardContent.displayName = 'CardContent';
