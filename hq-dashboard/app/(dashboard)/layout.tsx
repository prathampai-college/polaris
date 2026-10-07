'use client';
import Link from 'next/link';
import { useState } from 'react';
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

function LoginGate() {
  const { login, selectedStation, stationName } = useDashboard();
  const [pin, setPin] = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); login(pin); }}
      className="mx-auto mt-16 max-w-sm space-y-4 border border-structure bg-surface p-6"
    >
      <h1 className="text-lg font-black text-ink">HQ sign-in required</h1>
      <p className="text-sm text-slate">
        Every action here is written to the audit log under your identity. Sign in to view and act on {stationName || selectedStation}.
      </p>
      <label htmlFor="gate-pin" className="block font-mono text-xs font-bold text-ink">Access PIN</label>
      <input
        id="gate-pin"
        type="password"
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        className="h-11 w-full border border-structure bg-canvas px-3 text-sm focus:outline-none focus:border-cobalt"
      />
      <button type="submit" className="h-11 w-full border border-structure bg-cobalt font-mono text-sm font-bold text-white hover:bg-structure">
        Sign in
      </button>
    </form>
  );
}

function Gated({ children }: { children: React.ReactNode }) {
  const { authReady, loggedIn } = useDashboard();
  if (!authReady) return null;
  return loggedIn ? <>{children}</> : <LoginGate />;
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
          <main className="min-w-0 flex-1 space-y-4 pb-16"><Gated>{children}</Gated></main>
        </div>
      </div>
    </DashboardProvider>
  );
}
