'use client';
import { useEffect, useMemo, useState } from 'react';
import { useDashboard } from '../../../lib/context';
import { api, ApiError } from '../../../lib/api';

type Asset = {
  id: string;
  sku: string;
  name: string;
  crate_id: string;
  barcode: string;
  category: string;
  criticality: string;
  expiry_date?: string | null;
  qty: number;
  unit: string;
  version: number;
  station_id?: string | null;
};

// Phase 1.2: STATION_CRATES removed — scoping now via asset.station_id from
// GET /assets join (fallback to this legacy map if station_id missing).
const LEGACY_STATION_CRATES: Record<string, string[]> = {
  'ST-BHARATI': ['C1-K1', 'C1-K2', 'C2-K1', 'C2-K2', 'C2-K3', 'C3-K1', 'C3-K2'],
  'ST-MAITRI': ['C4-K1', 'C4-K2', 'C5-K1', 'C5-K2'],
  'ST-HIMADRI': ['C6-K1'],
};

export default function InventoryPage() {
  const { selectedStation } = useDashboard();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assetQ, setAssetQ] = useState('');
  const [onlyCurrentStation, setOnlyCurrentStation] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<Asset[]>('/assets')
      .then((a) => !cancelled && setAssets(a || []))
      .catch((e: ApiError) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Station-scoped Assets vs All Assets (Phase 1.2: prefer server station_id, fallback to legacy crate map)
  const currentStationAssets = useMemo(() => {
    const hasStationId = assets.some((a) => a.station_id);
    if (hasStationId) return assets.filter((a) => a.station_id === selectedStation);
    const crates = LEGACY_STATION_CRATES[selectedStation] || [];
    return assets.filter((a) => crates.includes(a.crate_id));
  }, [assets, selectedStation]);

  const displayedAssets = useMemo(() => {
    let list = onlyCurrentStation ? currentStationAssets : assets;
    if (assetQ) {
      const q = assetQ.toLowerCase();
      list = list.filter((a) => `${a.sku} ${a.name} ${a.crate_id} ${a.category}`.toLowerCase().includes(q));
    }
    return list;
  }, [assets, currentStationAssets, onlyCurrentStation, assetQ]);

  if (error) {
    return (
      <div className="border border-flare/40 bg-flare/5 p-4 text-xs text-flare">
        Couldn't load fleet inventory: {error}. Check the HQ API is reachable.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-3.5 flex flex-col sm:flex-row justify-between gap-3">
        <div className="flex-1 relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate">⌕</span>
          <input
            value={assetQ}
            onChange={(e) => setAssetQ(e.target.value)}
            placeholder="Search SKU, item name, crate bay, category…"
            className="w-full bg-canvas border border-structure pl-9 pr-3.5 py-2 text-xs text-ink placeholder:text-slate focus:outline-none focus:border-cobalt"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setOnlyCurrentStation((v) => !v)}
            className={`px-3 py-1.5 text-xs font-bold font-mono border transition ${
              onlyCurrentStation
                ? 'bg-cobalt text-white border-cobalt'
                : 'bg-surface text-slate border-structure hover:border-cobalt hover:text-cobalt'
            }`}
          >
            {onlyCurrentStation ? `Scoped to ${selectedStation}` : 'Showing All Stations'}
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[64vh] overflow-y-auto scroll-thin divide-y divide-structure/15">
          {loading && <div className="p-4 text-xs text-slate">Loading assets…</div>}
          {!loading && displayedAssets.length === 0 && (
            <div className="p-4 text-xs text-slate">No matching assets.</div>
          )}
          {!loading &&
            displayedAssets.map((a) => (
              <div key={a.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-canvas transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-ink">{a.sku}</span>
                    <span
                      className={`text-[9px] px-2 py-0.5 font-bold border ${
                        a.criticality === 'CRITICAL' ? 'pill-critical' : 'border-structure/30 bg-canvas text-slate'
                      }`}
                    >
                      {a.criticality}
                    </span>
                    {a.expiry_date && <span className="text-[10px] text-flare font-mono">exp {a.expiry_date}</span>}
                  </div>
                  <div className="text-sm font-semibold text-ink mt-0.5">{a.name}</div>
                  <div className="text-xs text-slate font-mono mt-0.5">
                    Crate {a.crate_id} · Barcode: {a.barcode} · Cat: {a.category}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-lg font-black text-ink">
                    {a.qty} <span className="text-xs font-normal text-slate">{a.unit}</span>
                  </div>
                  <div className="text-[10px] text-slate font-mono">v{a.version}</div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
