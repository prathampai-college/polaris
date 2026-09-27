'use client';
import React, { useState, useMemo, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { CONTAINER_SPECS, CRATE_COORDS, STATION_CONTAINERS } from '@polaris/shared/containers.js';

// Releases GPU geometries/materials on tab unmount - prevents WebGL context loss on tablets.
function GLCleanup() {
  const gl = useThree((s: any) => s.gl);
  const scene = useThree((s: any) => s.scene);
  useEffect(() => () => {
    try {
      scene.traverse((o: any) => {
        try { o.geometry?.dispose?.(); } catch {}
        const m = o.material;
        const kill = (x: any) => { try { x.map?.dispose?.(); x.dispose?.(); } catch {} };
        if (Array.isArray(m)) m.forEach(kill); else if (m) kill(m);
      });
    } catch {}
    try { gl.dispose(); } catch {}
  }, [gl, scene]);
  return null;
}

export interface AssetRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  qty: number;
  unit: string;
  expiry_date?: string | null;
  criticality: string;
  crate_id: string;
  barcode?: string;
  version?: number;
}

const COBALT = '#0047FF';
const FLARE = '#FF4800';
const STRUCTURE = '#101928';

function CrateMesh({
  id,
  position,
  assets,
  isHL,
  onClick,
}: {
  id: string;
  position: [number, number, number];
  assets: AssetRow[];
  isHL: boolean;
  onClick: (id: string) => void;
}) {
  const primaryAsset = assets[0];
  const hasCritical = assets.some(a => a.criticality === 'CRITICAL' && a.qty <= 5);
  const hasLow = assets.some(a => a.qty <= 3);

  let color = '#94A3B8'; // empty — neutral slate
  if (isHL) color = COBALT; // selected
  else if (hasCritical) color = FLARE; // critical
  else if (hasLow) color = '#F97316'; // low
  else if (assets.length > 0) color = '#10B981'; // stocked

  return (
    <group position={position} onClick={(e) => { e.stopPropagation(); onClick(id); }}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.88, 0.80, 0.88]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.05} opacity={isHL ? 1.0 : 0.92} transparent />
      </mesh>

      <mesh>
        <boxGeometry args={[0.89, 0.81, 0.89]} />
        <meshBasicMaterial color={STRUCTURE} wireframe opacity={0.45} transparent />
      </mesh>

      <Text position={[0, 0.14, 0.46]} fontSize={0.14} color="#FFFFFF" anchorX="center" anchorY="middle">
        {id}
      </Text>

      {primaryAsset && (
        <Text position={[0, -0.14, 0.46]} fontSize={0.088} color="#F1F5F9" anchorX="center" anchorY="middle">
          {assets.length > 1 ? `${assets.length} SKUs (${primaryAsset.sku})` : `${primaryAsset.qty} ${primaryAsset.unit}`}
        </Text>
      )}
    </group>
  );
}

export function Container3D({
  assets = [],
  highlight = null,
  stationId = null,
  onPick,
  onSelectAsset,
}: {
  assets: AssetRow[];
  highlight?: string | null;
  stationId?: string | null;
  onPick?: (id: string) => void;
  onSelectAsset?: (asset: AssetRow) => void;
}) {
  const availableContainers = useMemo(() => {
    if (stationId && STATION_CONTAINERS[stationId]) return STATION_CONTAINERS[stationId];
    return Object.keys(CONTAINER_SPECS);
  }, [stationId]);

  const [activeContainer, setActiveContainer] = useState<string>(() => {
    if (highlight) {
      const p = highlight.split('-')[0];
      if (CONTAINER_SPECS[p]) return p;
    }
    return availableContainers[0] || 'C1';
  });

  const [selectedCrateId, setSelectedCrateId] = useState<string | null>(highlight || null);

  const cratesMap = useMemo(() => {
    const map = new Map<string, AssetRow[]>();
    for (const a of assets) {
      const cid = a.crate_id || 'UNKNOWN';
      if (!map.has(cid)) map.set(cid, []);
      map.get(cid)!.push(a);
    }
    return map;
  }, [assets]);

  useEffect(() => {
    if (stationId && STATION_CONTAINERS[stationId]) {
      const stationCon = STATION_CONTAINERS[stationId];
      if (!stationCon.includes(activeContainer)) setActiveContainer(stationCon[0]);
    }
  }, [stationId, activeContainer]);

  useEffect(() => {
    if (highlight) {
      setSelectedCrateId(highlight);
      const containerPrefix = highlight.split('-')[0];
      if (CONTAINER_SPECS[containerPrefix]) setActiveContainer(containerPrefix);
    }
  }, [highlight]);

  const spec = CONTAINER_SPECS[activeContainer] || CONTAINER_SPECS['C1'];
  const cratesToRender = useMemo<[string, [number, number, number]][]>(() => {
    if (!spec) return [];
    return spec.crates.map((id) => [id, CRATE_COORDS[id] || [0, 0, 0]]);
  }, [spec]);

  const selectedCrateAssets = selectedCrateId ? cratesMap.get(selectedCrateId) || [] : [];

  const handleCrateClick = (id: string) => {
    setSelectedCrateId(id);
    onPick?.(id);
  };

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto scroll-thin pb-1">
          {availableContainers.map((key) => {
            const cspec = CONTAINER_SPECS[key];
            if (!cspec) return null;
            return (
              <button
                key={key}
                onClick={() => { setActiveContainer(key); setSelectedCrateId(null); }}
                className={`px-3 py-1.5 font-mono text-xs font-semibold shrink-0 transition border ${
                  activeContainer === key ? 'bg-ink text-canvas border-structure' : 'bg-surface text-slate border-structure hover:text-ink'
                }`}
              >
                {`${key} ${cspec.type === 'ColdStore' ? 'ColdStore' : cspec.type === 'Hazmat' ? 'Hazmat' : 'Ambient'}`}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-slate mono font-medium">{spec.tempZone}</div>
      </div>

      <div className="w-full h-72 sm:h-80 bg-surface overflow-hidden relative border border-structure">
        <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 pointer-events-none">
          <div className="text-xs font-bold text-ink flex items-center gap-2">
            <span className="w-2 h-2 bg-cobalt animate-pulse" />
            <span>{spec.name}</span>
          </div>
          <div className="text-[10px] text-slate mono">{spec.crates.length} crates · drag to rotate · pinch to zoom</div>
        </div>

        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 text-[10px] text-ink pointer-events-none bg-surface/90 px-2.5 py-1 border border-structure">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#10B981]" /> Normal</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#F97316]" /> Low</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-flare" /> Critical</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-cobalt" /> Selected</span>
        </div>

        <Canvas camera={{ position: [0, 2.2, 4.8], fov: 46 }} shadows dpr={[1, 2]} gl={{ antialias: true, powerPreference: 'low-power' }}>
          <GLCleanup />
          <color attach="background" args={['#FFFFFF']} />
          <ambientLight intensity={0.9} />
          <directionalLight position={[6, 8, 4]} intensity={0.9} castShadow />
          <pointLight position={[-6, -4, -4]} intensity={0.3} />
          <OrbitControls enableZoom maxPolarAngle={Math.PI / 2 + 0.1} minDistance={2.2} maxDistance={8} />

          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[3.4, 2.0, 2.4]} />
            <meshBasicMaterial color={STRUCTURE} wireframe opacity={0.3} transparent />
          </mesh>

          <gridHelper args={[5, 6, STRUCTURE, '#CBD5E1']} position={[0, -1.0, 0]} />

          {cratesToRender.map(([id, pos]) => (
            <CrateMesh key={id} id={id} position={pos} assets={cratesMap.get(id) || []} isHL={selectedCrateId === id} onClick={handleCrateClick} />
          ))}
        </Canvas>
      </div>

      {selectedCrateId && (
        <div className="border border-structure bg-surface p-4">
          <div className="flex items-center justify-between border-b border-structure/30 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="border border-cobalt/30 bg-cobalt/10 px-2 py-0.5 font-mono text-xs font-bold text-cobalt">CRATE {selectedCrateId}</span>
              <span className="text-xs text-slate">{selectedCrateAssets.length} asset{selectedCrateAssets.length !== 1 ? 's' : ''} stored</span>
            </div>
            <button onClick={() => setSelectedCrateId(null)} className="text-xs text-slate hover:text-ink px-2 py-1 border border-structure">Close</button>
          </div>

          {selectedCrateAssets.length > 0 ? (
            <div className="space-y-2">
              {selectedCrateAssets.map((asset) => (
                <div key={asset.id} onClick={() => onSelectAsset?.(asset)} className="flex items-center justify-between border border-structure/40 hover:border-cobalt px-3 py-2 cursor-pointer transition">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-ink">{asset.sku}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 font-bold ${asset.criticality === 'CRITICAL' ? 'border border-flare/30 bg-flare/10 text-flare' : 'bg-canvas text-slate'}`}>{asset.criticality}</span>
                      {asset.expiry_date && <span className="text-[10px] text-amber-700">exp {asset.expiry_date}</span>}
                    </div>
                    <div className="text-xs text-slate mt-0.5">{asset.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-ink">{asset.qty} <span className="text-xs font-normal text-slate">{asset.unit}</span></div>
                    <div className="text-[10px] text-cobalt hover:underline">Inspect →</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-xs text-slate">No inventory recorded in crate {selectedCrateId}.</div>
          )}
        </div>
      )}
    </div>
  );
}
