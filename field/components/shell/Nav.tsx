'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Boxes, Crosshair, ListChecks, MoreHorizontal, SatelliteDish, ScanLine, Settings2, Ship, Truck, Users, type LucideIcon } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';
import { cn } from '../../lib/utils';

export const NAV: { href: string; label: string; icon: LucideIcon; primary?: boolean }[] = [
  { href: '/', label: 'Brief', icon: ListChecks, primary: true },
  { href: '/scan', label: 'Scan', icon: ScanLine, primary: true },
  { href: '/inventory', label: 'Stock', icon: Boxes, primary: true },
  { href: '/muster', label: 'Muster', icon: Users, primary: true },
  { href: '/indents', label: 'Indents', icon: Truck },
  { href: '/expeditions', label: 'Cargo', icon: Ship },
  { href: '/locate', label: 'Locate', icon: Crosshair },
  { href: '/comms', label: 'Comms', icon: SatelliteDish, primary: true },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

const isActive = (path: string, href: string) => (href === '/' ? path === '/' : path.startsWith(href));

/** Landscape tablet: labelled left rail. */
export function NavRail() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="sticky top-[var(--tap)] hidden h-[calc(100dvh-var(--tap))] w-24 shrink-0 flex-col border-r border-structure bg-surface lg:flex">
      {NAV.map(({ href, label, icon: Icon }) => {
        const on = isActive(path, href);
        return (
          <Link key={href} href={href} aria-current={on ? 'page' : undefined}
            className={cn('flex min-h-[64px] flex-col items-center justify-center gap-1 border-b border-structure/20 font-mono text-xs font-semibold uppercase tracking-[0.08em]',
              on ? 'bg-ink text-canvas' : 'text-slate hover:bg-canvas hover:text-ink')}>
            <Icon size={22} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Portrait / phone: thumb-reach bottom bar with the 5 most-used routes + More. */
export function BottomBar() {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const primary = NAV.filter((n) => n.primary);
  const rest = NAV.filter((n) => !n.primary);
  const restActive = rest.some((n) => isActive(path, n.href));
  return (
    <>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-structure bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {primary.map(({ href, label, icon: Icon }) => {
          const on = isActive(path, href);
          return (
            <Link key={href} href={href} aria-current={on ? 'page' : undefined}
              className={cn('flex min-h-[60px] flex-1 flex-col items-center justify-center gap-0.5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.06em]',
                on ? 'bg-ink text-canvas' : 'text-slate')}>
              <Icon size={22} aria-hidden />{label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMore(true)} aria-label="More sections"
          className={cn('flex min-h-[60px] flex-1 flex-col items-center justify-center gap-0.5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.06em]', restActive ? 'bg-ink text-canvas' : 'text-slate')}>
          <MoreHorizontal size={22} aria-hidden />More
        </button>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="p-4 pt-5">
          <SheetTitle className="eyebrow mb-3">More sections</SheetTitle>
          <div className="grid grid-cols-2 gap-2">
            {rest.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => setMore(false)}
                className={cn('flex min-h-[64px] items-center gap-3 border border-structure px-4 font-mono text-sm font-semibold uppercase', isActive(path, href) ? 'bg-ink text-canvas' : 'bg-surface text-ink')}>
                <Icon size={22} aria-hidden />{label}
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
