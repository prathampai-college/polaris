'use client';
import React, { useEffect, useState } from 'react';
import { SourceBadge } from './SourceBadge';
import { HQ } from '../lib/api';

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
  fetched_at?: string | null;
  age_sec?: number | null;
  reason?: string | null;
};

export function VesselMap({ stationId = 'ST-BHARATI' }: { stationId?: string }) {
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // loading starts true; re-polls keep the map mounted (no 15s flicker)
        const r = await fetch(`${HQ}/vessels?station_id=${stationId}`);
        if (!r.ok) throw new Error(`${r.status}`);
        const data = await r.json();
        if (!cancelled) { setVessels(Array.isArray(data) ? data : []); setError(null); }
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

  if (loading) return <div className="text-xs text-slate p-4 border border-structure">Loading vessels…</div>;
  if (error) return <div className="text-xs text-flare p-4 border border-flare/30">Vessel fetch error: {error}</div>;
  if (!vessels.length) return (
    <div className="text-xs text-slate p-4 border border-dashed border-structure/50 text-center">
      No vessel positions yet for {stationId} — first poll lands ~15s after HQ boot.<br />
      <span className="font-mono text-[10px]">GET /vessels?station_id={stationId} → []</span>
    </div>
  );

  const v0 = vessels[0];

  return (
    <div className="w-full border border-structure bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs font-bold text-ink flex items-center gap-2">
            <span>Vessel tracker — {stationId}</span>
            <SourceBadge source={v0?.source} fetchedAt={v0?.fetched_at} ageSec={v0?.age_sec} liveLabel="LIVE AIS" />
          </div>
          <div className="text-[11px] text-slate">AISHub live when key + quota allow{v0?.reason && v0.source !== 'live' ? <span className="font-mono text-amber-700"> · {v0.reason}</span> : null} — schedule interpolation otherwise.</div>
        </div>
        <div className="text-[10px] font-mono text-slate">cache /tmp/ais_cache.json · poll 15m</div>
      </div>

      <LeafletOrFallback vessels={vessels} />

      <div className="overflow-x-auto scroll-thin">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-structure text-slate text-left">
              <th className="py-2 px-2">IMO / vessel</th>
              <th className="py-2 px-2 text-center">Position</th>
              <th className="py-2 px-2 text-center">SOG</th>
              <th className="py-2 px-2 text-center">ETA</th>
              <th className="py-2 px-2 text-center">Source</th>
            </tr>
          </thead>
          <tbody>
            {vessels.map((v) => (
              <tr key={v.imo} className="border-b border-structure/20 hover:bg-canvas">
                <td className="py-2.5 px-2">
                  <div className="font-mono font-bold text-ink">{v.imo}</div>
                  <div className="text-[11px] text-slate">{v.name}</div>
                </td>
                <td className="py-2.5 px-2 text-center font-mono text-ink">{v.lat.toFixed(2)}°, {v.lon.toFixed(2)}°</td>
                <td className="py-2.5 px-2 text-center text-ink">{v.sog} kn</td>
                <td className="py-2.5 px-2 text-center">
                  <span className="border border-cobalt/30 bg-cobalt/10 px-2 py-0.5 font-mono text-[11px] text-cobalt">{v.eta}</span>
                </td>
                <td className="py-2.5 px-2 text-center">
                  <SourceBadge source={v.source} fetchedAt={v.fetched_at} ageSec={v.age_sec} liveLabel="LIVE" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-slate font-mono">Air-gapped fallback: ETA pill shown when Leaflet tiles unavailable. Field tablets receive via <span className="text-ink/70">DOWNSTREAM_DELTA vessels</span> over encrypted WS.</div>
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
      .then((r) => {
        if (!r.ok) throw new Error('tile probe fail');
        return import('react-leaflet');
      })
      .then(async (rl) => {
        const L = await import('leaflet');
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
      <div className="w-full h-48 overflow-hidden border border-structure relative">
        <MapContainer center={center} zoom={3} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {vessels.map((v) => (
            <Marker key={v.imo} position={[v.lat, v.lon]}>
              <Popup>
                <b>{v.name}</b> ({v.imo})<br />{v.lat.toFixed(2)}, {v.lon.toFixed(2)}<br />SOG {v.sog} kn<br />ETA {v.eta}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        <div className="absolute bottom-2 right-2 text-[10px] font-mono text-canvas bg-ink/80 px-2 py-1 border border-structure pointer-events-none">LIVE Leaflet · SOG {vessels[0]?.sog} kn</div>
      </div>
    );
  }

  // offline schematic fallback (always works air-gapped)
  return (
    <div className="w-full h-48 overflow-hidden border border-structure relative bg-canvas">
      <div className="tickgrid absolute inset-0 opacity-60" />
      <div className="absolute inset-0 grid place-items-center text-[10px] text-slate">Offline schematic — ETA pill primary when tiles unavailable</div>
      <div className="absolute inset-0 flex items-center justify-center gap-8">
        {vessels.map((v) => (
          <div key={v.imo} className="flex flex-col items-center gap-1">
            <div className="w-3 h-3 bg-cobalt animate-pulse" title={`${v.lat},${v.lon}`} />
            <span className="text-[9px] font-mono text-cobalt">{v.lat.toFixed(2)}, {v.lon.toFixed(2)}</span>
            <span className="text-[9px] font-bold text-ink">{v.name.slice(0, 12)}</span>
          </div>
        ))}
      </div>
      <div className="absolute bottom-2 right-2 text-[10px] font-mono text-slate bg-surface/90 px-2 py-1 border border-structure">SOG {vessels[0]?.sog} kn · {typeof navigator !== 'undefined' && !navigator.onLine ? 'offline schematic' : 'schematic'}</div>
    </div>
  );
}
