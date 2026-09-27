'use client';
import { useEffect, useState } from 'react';
import { useDashboard } from '../../../lib/context';
import { api, ApiError } from '../../../lib/api';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import type { AssetRow } from '../../../components/Container3D';

function LocatorWrap({ assets, stationId }: { assets: AssetRow[]; stationId?: string }) {
  const [Comp, setComp] = useState<any>(null);
  useEffect(() => { import('../../../components/Container3D').then((m) => setComp(() => m.Container3D)); }, []);
  if (!Comp) return <div className="text-xs text-slate h-72 flex items-center justify-center border border-structure">Loading 3D digital twin…</div>;
  return <ErrorBoundary label="3D twin"><Comp assets={assets} highlight={null} stationId={stationId} /></ErrorBoundary>;
}

export default function StationsPage() {
  const { selectedStation, stationName } = useDashboard();
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<AssetRow[]>('/assets').then((a) => !cancelled && setAssets(a || [])).catch((e: ApiError) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-base text-ink">Station Digital Twin & Containers</h2>
          <p className="text-xs text-slate">Coordinate-indexed supply bays across polar stations</p>
        </div>
        <span className="text-xs font-mono text-cobalt">{stationName}</span>
      </div>
      {error && <div className="border border-flare/40 bg-flare/5 p-3 text-xs text-flare">Couldn't load assets: {error}</div>}
      <LocatorWrap assets={assets} stationId={selectedStation} />
    </div>
  );
}
