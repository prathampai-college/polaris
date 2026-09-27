import * as React from 'react';
import { cn } from '../../lib/utils';

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className={cn('w-full text-xs', className)} {...props} />
    </div>
  );
}

export function TableHead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('font-mono text-[11px] text-slate', className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-structure/30', className)} {...props} />;
}

export function TableHeadCell({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('px-3 py-2.5 text-left font-semibold', className)} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5 text-ink', className)} {...props} />;
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-10 text-center text-xs text-slate">
        {children}
      </td>
    </tr>
  );
}
