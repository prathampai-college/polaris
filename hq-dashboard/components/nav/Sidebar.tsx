'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Box, Boxes, FileClock, FileText, Grid2x2, Map, Radio, ScrollText, Thermometer, Users } from 'lucide-react';
import { cn } from '../../lib/utils';

const NAV = [
  { href: '/', label: 'Fleet Overview', desc: '3 polar stations', Icon: Grid2x2 },
  { href: '/command', label: 'Command Timeline', desc: 'Cross-station events', Icon: ScrollText },
  { href: '/link-health', label: 'Link Health', desc: 'Who HQ can hear', Icon: Radio },
  { href: '/expeditions', label: 'Expedition Planner', desc: 'ISEA + Himadri programs', Icon: FileText },
  { href: '/forecast', label: 'Thermo AI Forecast', desc: 'Physics + ML model', Icon: Thermometer },
  { href: '/personnel', label: 'Personnel & Safety', desc: 'Roster, sorties, SOS', Icon: Users },
  { href: '/stations', label: 'Station Assets', desc: 'Containers & crates', Icon: Map },
  { href: '/indents', label: 'Indent Workbench', desc: 'Resupply pipeline', Icon: FileClock },
  { href: '/inventory', label: 'Fleet Inventory', desc: 'All SKUs', Icon: Box },
  { href: '/audit', label: 'Audit Trail', desc: 'Immutable log', Icon: Activity },
  { href: '/locate', label: '3D Digital Twin', desc: 'Container + vessel view', Icon: Boxes },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-1">
      {NAV.map(({ href, label, desc, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 border border-structure px-3 py-2.5 transition-colors',
              active ? 'bg-ink text-canvas' : 'bg-surface text-ink hover:border-cobalt'
            )}
          >
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center border', active ? 'border-canvas/30' : 'border-structure/40')}>
              <Icon size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold leading-tight">{label}</span>
              <span className={cn('block truncate font-mono text-[10px]', active ? 'text-canvas/60' : 'text-slate')}>{desc}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
