'use client';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import { useDashboard, STATIONS } from '../../lib/context';
import { Sheet, SheetContent, SheetTrigger } from '../ui/sheet';
import { SidebarNav } from './Sidebar';

export function Topbar() {
  const { selectedStation, setSelectedStation, loggedIn, role, login, logout, sseStatus } = useDashboard();
  const [pin, setPin] = useState('');
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-structure bg-canvas/95 backdrop-blur">
      <div className="mx-auto flex h-[64px] max-w-[1400px] items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-3">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger className="grid h-9 w-9 place-items-center border border-structure lg:hidden" aria-label="Open navigation">
              <Menu size={16} />
            </SheetTrigger>
            <SheetContent>
              <div className="mb-4 font-mono text-xs font-bold tracking-[0.1em] text-ink">POLARIS HQ</div>
              <SidebarNav onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center border border-structure bg-cobalt font-black text-white">◊</div>
            <div className="hidden sm:block">
              <div className="text-[13px] font-black leading-tight tracking-[0.1em] text-ink">POLARIS HQ</div>
              <div className="font-mono text-[10px] text-slate">NCPOR / MoES Fleet Command</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            aria-label="Station"
            className="h-9 border border-structure bg-surface px-2.5 font-mono text-xs font-semibold text-ink focus:outline-none focus:border-cobalt"
          >
            {STATIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <span className={`hidden items-center gap-1.5 border px-2.5 h-9 font-mono text-[11px] sm:inline-flex ${sseStatus === 'live' ? 'border-cobalt/30 bg-cobalt/10 text-cobalt' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
            <span className={`h-1.5 w-1.5 ${sseStatus === 'live' ? 'bg-cobalt animate-pulse' : 'bg-amber-500'}`} />
            {sseStatus === 'live' ? 'LIVE' : 'POLLING'}
          </span>

          {loggedIn ? (
            <div className="flex items-center gap-2">
              <span className="hidden font-mono text-[11px] text-slate lg:inline">{role || 'VIEWER'}</span>
              <button onClick={logout} className="h-9 border border-structure px-3 font-mono text-xs font-semibold text-ink hover:bg-structure hover:text-canvas">
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && login(pin)}
                placeholder="PIN"
                aria-label="Access PIN"
                className="h-9 w-20 border border-structure bg-surface px-2.5 text-xs focus:outline-none focus:border-cobalt"
              />
              <button onClick={() => login(pin)} className="h-9 border border-structure bg-cobalt px-3.5 font-mono text-xs font-bold text-white hover:bg-structure">
                Login
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
