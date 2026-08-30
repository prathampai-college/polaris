'use client';
import React, { useEffect, useState } from 'react';

const HQ = process.env.NEXT_PUBLIC_HQ_URL || 'http://localhost:8000';

type Vessel = {
  imo: string;
  name: string;
  lat: number;
  lon: number;
  sog: number;
  eta: string;
  station_id: string;
  last_seen: string;
  source: string;
};

export function VesselMap({ stationId = 'ST-BHARATI' }: { stationId?: string }) {
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string>('auto');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const r = await fetch(`${HQ}/vessels?station_id=${stationId}`);
        if (!r.ok) throw new Error(`${r.status}`);
        const data = await r.json();
        if (!cancelled) {
          setVessels(Array.isArray(data) ? data : []);
          setMode(data[0]?.source || 'mock');
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [stationId]);

  if (loading) return <div className="text-xs text-white/40 p-4 border border-white/10 rounded-xl">Loading vessels…</div>;
  if (error) return <div className="text-xs text-red-400 p-4 border border-red-500/20 rounded-xl">Vessel fetch error: {error}</div>;
  if (!vessels.length) return <div className="text-xs text-white/40 p-4 border border-dashed border-white/15 rounded-xl text-center">No vessel tracked for {stationId} — mock schedule will appear after poller first run (15s).<br/><span className="font-mono text-[10px]">GET /vessels?station_id={stationId} → []</span></div>;

  return (
    <div className="w-full bg-slate-950/70 rounded-2xl p-4 border border-white/10 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs font-bold text-white flex items-center gap-2">
            <span>Vessel Tracker — {stationId}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${mode === 'live' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30'}`}>{mode === 'live' ? 'LIVE AIS' : 'MOCK SCHEDULE'}</span>
          </div>
          <div className="text-[11px] text-white/50">Adaptive AISHub/MarineTraffic → fallback <span className="font-mono">shared/vessel_schedule.json</span> (Sagar Nidhi interpolation) on 429/no key.</div>
        </div>
        <div className="text-[10px] font-mono text-white/40">cache /tmp/ais_cache.json • poll 15m</div>
      </div>

      {/* Leaflet map with offline ETA pill fallback */}
      <LeafletOrFallback vessels={vessels} />

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-white/40 text-left">
              <th className="py-2 px-2">IMO / Vessel</th>
              <th className="py-2 px-2 text-center">Position</th>
              <th className="py-2 px-2 text-center">SOG</th>
              <th className="py-2 px-2 text-center">ETA</th>
              <th className="py-2 px-2 text-center">Source</th>
            </tr>
          </thead>
          <tbody>
            {vessels.map(v => (
              <tr key={v.imo} className="border-b border-white/5 hover:bg-white/[0.03]">
                <td className="py-2.5 px-2">
                  <div className="font-mono font-bold text-white">{v.imo}</div>
                  <div className="text-[11px] text-white/60">{v.name}</div>
                </td>
                <td className="py-2.5 px-2 text-center font-mono text-white">{v.lat.toFixed(2)}°, {v.lon.toFixed(2)}°</td>
                <td className="py-2.5 px-2 text-center text-white">{v.sog} kn</td>
                <td className="py-2.5 px-2 text-center">
                  <span className="px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/20 font-mono text-[11px]">{v.eta}</span>
                </td>
                <td className="py-2.5 px-2 text-center">
                  <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] border ${v.source === 'live' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/20'}`}>{v.source}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-white/30 font-mono">Air-gapped fallback: ETA pill shown when Leaflet tiles unavailable. Field tablets receive via <span className="text-white/50">DOWNSTREAM_DELTA vessels</span> over encrypted WS.</div>
    </div>
  );
}

function LeafletOrFallback({ vessels }: { vessels: Vessel[] }) {
  const [useLeaflet, setUseLeaflet] = useState(false);
  const [LeafletComps, setLeafletComps] = useState<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.onLine) return;
    // probe tile reachability with 2s timeout; if fails keep schematic
    fetch('https://tile.openstreetmap.org/0/0/0.png', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(2000) })
      .then(r => {
        if (!r.ok) throw new Error('tile probe fail');
        return import('react-leaflet');
      })
      .then(async (rl) => {
        const L = await import('leaflet');
        // fix default icon paths for Next.js (uses /leaflet images)
        // @ts-ignore
        delete (L.Icon.Default.prototype as any)._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });
        setLeafletComps(rl);
        setUseLeaflet(true);
      })
      .catch(() => setUseLeaflet(false));
  }, []);

  if (useLeaflet && LeafletComps) {
    const { MapContainer, TileLayer, Marker, Popup } = LeafletComps;
    const center: [number, number] = [vessels[0].lat, vessels[0].lon];
    return (
      <div className="w-full h-48 rounded-xl overflow-hidden border border-white/10 relative">
        <MapContainer center={center} zoom={3} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {vessels.map(v => (
            <Marker key={v.imo} position={[v.lat, v.lon]}>
              <Popup>
                <b>{v.name}</b> ({v.imo})<br />{v.lat.toFixed(2)}, {v.lon.toFixed(2)}<br />SOG {v.sog} kn<br />ETA {v.eta}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        <div className="absolute bottom-2 right-2 text-[10px] font-mono text-white/80 bg-black/60 px-2 py-1 rounded-full border border-white/10 pointer-events-none">LIVE Leaflet • SOG {vessels[0]?.sog} kn</div>
      </div>
    );
  }

  // offline schematic fallback (always works air-gapped)
  return (
    <div className="w-full h-48 rounded-xl overflow-hidden border border-white/10 relative bg-gradient-to-br from-blue-950 to-slate-900">
      <div className="absolute inset-0 grid place-items-center text-[10px] text-white/30">Offline schematic — ETA pill primary when tiles unavailable</div>
      <div className="absolute inset-0">
        <div className="absolute inset-2 border border-white/10 rounded-lg" />
        <div className="absolute inset-0 flex items-center justify-center gap-8">
          {vessels.map(v => (
            <div key={v.imo} className="flex flex-col items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-lg shadow-cyan-400/40 animate-pulse" title={`${v.lat},${v.lon}`} />
              <span className="text-[9px] font-mono text-cyan-300">{v.lat.toFixed(2)}, {v.lon.toFixed(2)}</span>
              <span className="text-[9px] font-bold text-white">{v.name.slice(0, 12)}</span>
            </div>
          ))}
        </div>
        <div className="absolute bottom-2 right-2 text-[10px] font-mono text-white/50 bg-black/40 px-2 py-1 rounded-full border border-white/10">SOG {vessels[0]?.sog} kn • Mock fallback</div>
      </div>
    </div>
  );
}
