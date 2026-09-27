'use client';
import Link from 'next/link';
import { DashboardProvider, useDashboard } from '../../lib/context';
import { Topbar } from '../../components/nav/Topbar';
import { SidebarNav } from '../../components/nav/Sidebar';

function Toast() {
  const { toast } = useDashboard();
  if (!toast) return null;
  return (
    <div className="fixed left-1/2 top-[76px] z-50 -translate-x-1/2 border border-structure bg-ink px-4 py-2.5 font-mono text-xs font-semibold text-canvas">
      {toast}
    </div>
  );
}

function EmergencyBanner() {
  const { activeEmergencies } = useDashboard();
  if (activeEmergencies.length === 0) return null;
  const first = activeEmergencies[0];
  return (
    <div className="border-b border-structure bg-flare px-4 py-3 flex items-center justify-between gap-3 text-xs font-bold text-white">
      <div className="min-w-0 flex items-center gap-3">
        <span className="uppercase tracking-wider font-black shrink-0">
          Active distress: {first.station_id} · {String(first.type || '').replace('SOS_', '')}
        </span>
        <span className="hidden sm:inline truncate font-mono font-normal text-white/85">
          {first.location_coord || 'Grid reference unknown'} · reported by {first.reported_by}
          {activeEmergencies.length > 1 ? ` · +${activeEmergencies.length - 1} more` : ''}
        </span>
      </div>
      <Link href="/personnel" className="shrink-0 bg-white text-flare px-3 py-1.5 font-black hover:bg-canvas">
        Incident command →
      </Link>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <div className="min-h-dvh bg-canvas text-ink">
        <Topbar />
        <EmergencyBanner />
        <Toast />
        <div className="mx-auto flex max-w-[1400px] gap-4 px-4 py-4">
          <aside className="hidden w-[240px] shrink-0 lg:block">
            <div className="sticky top-[84px] space-y-3">
              <SidebarNav />
            </div>
          </aside>
          <main className="min-w-0 flex-1 space-y-4 pb-16">{children}</main>
        </div>
      </div>
    </DashboardProvider>
  );
}
