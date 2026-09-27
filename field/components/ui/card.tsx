import * as React from 'react';
import { cn } from '../../lib/utils';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('border border-structure bg-surface', className)} {...props} />
));
Card.displayName = 'Card';

export function CardHeader({ className, eyebrow, title, action, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { eyebrow?: React.ReactNode; title?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-structure px-4 py-3', className)} {...props}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        {title && <h2 className="font-display text-2xl leading-tight text-ink">{title}</h2>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

/** Page title block — serif display + mono eyebrow, matching website section heads. */
export function PageHead({ eyebrow, title, children, action }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-structure pb-4">
      <div className="min-w-0">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="mt-1 font-display text-4xl leading-none tracking-[-0.02em] text-ink sm:text-5xl">{title}</h1>
        {children && <p className="mt-2 max-w-2xl text-sm text-slate">{children}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </header>
  );
}

/** Honest empty state: says what's missing and why, never a fake value. */
export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="tickgrid flex flex-col items-start gap-2 border border-dashed border-structure/50 p-6">
      <div className="font-mono text-sm font-semibold text-ink">{title}</div>
      {children && <p className="max-w-prose text-sm text-slate">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="border border-flare bg-flare/10 px-4 py-3 text-sm text-ink"><span className="font-mono font-semibold text-flare">ERROR · </span>{children}</div>;
}
