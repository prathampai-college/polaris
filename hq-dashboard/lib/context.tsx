'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HQ, api } from './api';
import { clearToken, getRole, getToken, isExpired, setToken as persistToken } from './auth';

export const STATIONS = [
  { id: 'ST-BHARATI', name: 'Bharati (East Antarctica)' },
  { id: 'ST-MAITRI', name: 'Maitri (Antarctica)' },
  { id: 'ST-HIMADRI', name: 'Himadri (Arctic)' },
];

type Telemetry = Record<string, any> | null;
type TrendPoint = Record<string, any>;
type Emergency = Record<string, any>;

type DashboardState = {
  selectedStation: string;
  setSelectedStation: (id: string) => void;
  stationName: string;
  loggedIn: boolean;
  role: string | null;
  login: (pin: string) => Promise<boolean>;
  logout: () => void;
  toast: string | null;
  pushToast: (msg: string) => void;
  tele: Telemetry;
  trend: TrendPoint[];
  sseStatus: 'connecting' | 'live' | 'polling';
  activeEmergencies: Emergency[];
};

const DashboardContext = createContext<DashboardState | null>(null);

export function useDashboard(): DashboardState {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [selectedStation, setSelectedStation] = useState('ST-BHARATI');
  const [loggedIn, setLoggedIn] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tele, setTele] = useState<Telemetry>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'live' | 'polling'>('connecting');
  const [activeEmergencies, setActiveEmergencies] = useState<Emergency[]>([]);

  // Cross-cutting alert banner needs this regardless of which route is active.
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      api
        .get<Emergency[]>('/emergencies')
        .then((list) => !cancelled && setActiveEmergencies((list || []).filter((e) => e.status !== 'RESOLVED')))
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const stored = getToken();
    if (stored && !isExpired(stored)) {
      setLoggedIn(true);
      setRole(getRole(stored));
    }
  }, []);

  const pushToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const login = useCallback(
    async (pin: string) => {
      const cleanPin = pin.trim();
      if (!cleanPin) {
        pushToast('Please enter your station access PIN');
        return false;
      }
      try {
        const res = await fetch(`${HQ}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id: `HQ-COMMAND-${Date.now().toString().slice(-4)}`,
            pin: cleanPin,
            station_id: selectedStation,
            role: 'NCPOR_ADMIN',
          }),
        });
        if (!res.ok) {
          pushToast('Login failed: invalid PIN');
          return false;
        }
        const data = await res.json();
        persistToken(data.token);
        setLoggedIn(true);
        setRole(getRole(data.token));
        pushToast('Authenticated');
        return true;
      } catch {
        pushToast('Login network error');
        return false;
      }
    },
    [selectedStation, pushToast]
  );

  const logout = useCallback(() => {
    clearToken();
    setLoggedIn(false);
    setRole(null);
    pushToast('Logged out');
  }, [pushToast]);

  // Telemetry SSE, scoped once per selected station. Polling only runs while
  // SSE hasn't confirmed live — the old dashboard ran both forever, doubling load.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fetchLatest = async () => {
      try {
        const res = await fetch(`${HQ}/telemetry/latest?station_id=${selectedStation}`);
        const t = await res.json();
        if (!cancelled && t?.temp_outside != null) setTele(t);
      } catch {}
    };

    setSseStatus('connecting');
    fetchLatest();
    pollRef.current = setInterval(fetchLatest, 8000);

    let es: EventSource | null = null;
    try {
      es = new EventSource(`${HQ}/telemetry/stream`);
      es.onopen = () => {
        setSseStatus('live');
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      };
      es.addEventListener('telemetry', ((ev: MessageEvent) => {
        try {
          const t = JSON.parse(ev.data);
          if (t.station_id !== selectedStation) return;
          setTele(t);
          setTrend((prev) => {
            const next = [...prev, { day: t.ts?.slice(11, 16) || 'live', qty: t.qty, forecast: t.forecast, avg_temp: t.temp_outside, avg_load: t.dg_load, wind_speed: t.wind_speed }];
            return next.length > 14 ? next.slice(-14) : next;
          });
        } catch {}
      }) as EventListener);
      es.onerror = () => {
        setSseStatus('polling');
        es?.close();
        if (!pollRef.current) pollRef.current = setInterval(fetchLatest, 8000);
      };
    } catch {
      setSseStatus('polling');
    }

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      es?.close();
    };
  }, [selectedStation]);

  const stationName = useMemo(() => STATIONS.find((s) => s.id === selectedStation)?.name || selectedStation, [selectedStation]);

  const value: DashboardState = {
    selectedStation,
    setSelectedStation,
    stationName,
    loggedIn,
    role,
    login,
    logout,
    toast,
    pushToast,
    tele,
    trend,
    sseStatus,
    activeEmergencies,
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}
