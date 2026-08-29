'use client';
import React, { useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { CONTAINER_SPECS, CRATE_COORDS } from '@polaris/shared';

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

  let color = '#334155'; // empty
  if (isHL) color = '#F59E0B'; // highlighted gold
  else if (hasCritical) color = '#EF4444'; // critical red
  else if (hasLow) color = '#F97316'; // low orange
  else if (assets.length > 0) color = '#10B981'; // stocked emerald

  return (
    <group position={position} onClick={(e) => { e.stopPropagation(); onClick(id); }}>
      {/* Outer Crate Box */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.95, 0.85, 0.95]} />
        <meshStandardMaterial
          color={color}
          roughness={0.3}
          metalness={0.2}
          opacity={isHL ? 1.0 : 0.88}
          transparent
          wireframe={false}
        />
      </mesh>

      {/* Wireframe Outline for tactical styling */}
      <mesh>
        <boxGeometry args={[0.96, 0.86, 0.96]} />
        <meshBasicMaterial color={isHL ? '#FFFFFF' : '#000000'} wireframe opacity={0.35} transparent />
      </mesh>

      {/* Crate ID Label on Front Face */}
      <Text position={[0, 0.12, 0.5]} fontSize={0.16} color="#FFFFFF" anchorX="center" anchorY="middle">
        {id}
      </Text>

      {/* Stock summary or SKU */}
      {primaryAsset && (
        <Text position={[0, -0.15, 0.5]} fontSize={0.095} color="#E2E8F0" anchorX="center" anchorY="middle">
          {assets.length > 1 ? `${assets.length} SKUs (${primaryAsset.sku})` : `${primaryAsset.qty} ${primaryAsset.unit}`}
        </Text>
      )}
    </group>
  );
}

export function Container3D({
  assets = [],
  highlight = null,
  onPick,
  onSelectAsset,
}: {
  assets: AssetRow[];
  highlight: string | null;
  onPick?: (id: string) => void;
  onSelectAsset?: (asset: AssetRow) => void;
}) {
  const [activeContainer, setActiveContainer] = useState<string>('ALL');
  const [selectedCrateId, setSelectedCrateId] = useState<string | null>(highlight);

  // Group assets by crate
  const cratesMap = useMemo(() => {
    const map = new Map<string, AssetRow[]>();
    for (const a of assets) {
      const cid = a.crate_id || 'UNKNOWN';
      if (!map.has(cid)) map.set(cid, []);
      map.get(cid)!.push(a);
    }
    return map;
  }, [assets]);

  // Update selected crate if highlight prop changes
  React.useEffect(() => {
    if (highlight) {
      setSelectedCrateId(highlight);
      // Auto-switch container tab if crate belongs to a specific container
      const containerPrefix = highlight.split('-')[0];
      if (CONTAINER_SPECS[containerPrefix]) {
        setActiveContainer(containerPrefix);
      }
    }
  }, [highlight]);

  // Crates to render
  const cratesToRender = useMemo(() => {
    if (activeContainer === 'ALL') {
      return Object.entries(CRATE_COORDS);
    }
    const spec = CONTAINER_SPECS[activeContainer];
    if (!spec) return Object.entries(CRATE_COORDS);
    return Object.entries(CRATE_COORDS).filter(([id]) => spec.crates.includes(id));
  }, [activeContainer]);

  const selectedCrateAssets = selectedCrateId ? cratesMap.get(selectedCrateId) || [] : [];
  const activeSpec = CONTAINER_SPECS[activeContainer] || CONTAINER_SPECS['ALL'];

  const handleCrateClick = (id: string) => {
    setSelectedCrateId(id);
    onPick?.(id);
  };

  return (
    <div className="w-full flex flex-col gap-3">
      {/* Container Selection Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto scroll-thin pb-1">
          {Object.entries(CONTAINER_SPECS).map(([key, spec]) => (
            <button
              key={key}
              onClick={() => setActiveContainer(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition border ${
                activeContainer === key
                  ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20'
                  : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white'
              }`}
            >
              {key === 'ALL' ? '🌐 All Bays' : `${key} ${spec.type === 'ColdStore' ? '❄️ ColdStore' : spec.type === 'Hazmat' ? '⚠️ Hazmat' : '📦 Ambient'}`}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-white/50 mono font-medium">
          {activeSpec.tempZone}
        </div>
      </div>

      {/* 3D Canvas Box */}
      <div className="w-full h-72 sm:h-80 bg-slate-950/80 rounded-2xl overflow-hidden relative border border-white/10 shadow-inner">
        <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 pointer-events-none">
          <div className="text-xs font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{activeSpec.name}</span>
          </div>
          <div className="text-[10px] text-white/40 mono">Drag to rotate • Pinch to zoom</div>
        </div>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 text-[10px] text-white/60 pointer-events-none bg-black/60 backdrop-blur px-2.5 py-1 rounded-full border border-white/10">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#10B981]" /> Stocked</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#F97316]" /> Low</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#EF4444]" /> Critical</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#F59E0B]" /> Selected</span>
        </div>

        <Canvas camera={{ position: [0, 2.4, 5.5], fov: 48 }} shadows>
          <ambientLight intensity={0.7} />
          <directionalLight position={[6, 8, 4]} intensity={0.9} castShadow />
          <pointLight position={[-6, -4, -4]} intensity={0.4} />
          <OrbitControls enableZoom={true} maxPolarAngle={Math.PI / 2 + 0.1} minDistance={2.5} maxDistance={9} />

          {/* ISO-20 Container Tactical Wireframe Envelope */}
          <mesh position={[0, 0.1, 0]}>
            <boxGeometry args={[3.6, 2.6, 2.8]} />
            <meshBasicMaterial color="#38BDF8" wireframe opacity={0.2} transparent />
          </mesh>

          {/* Container Floor Grid */}
          <gridHelper args={[6, 6, '#3B82F6', '#1E293B']} position={[0, -1.2, 0]} />

          {/* Render Crates */}
          {cratesToRender.map(([id, pos]) => (
            <CrateMesh
              key={id}
              id={id}
              position={pos}
              assets={cratesMap.get(id) || []}
              isHL={selectedCrateId === id}
              onClick={handleCrateClick}
            />
          ))}
        </Canvas>
      </div>

      {/* Interactive Crate Inspector Drawer / Box */}
      {selectedCrateId && (
        <div className="bg-slate-900/90 border border-blue-500/30 rounded-xl p-4 transition animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-xs font-bold border border-amber-500/30">
                CRATE {selectedCrateId}
              </span>
              <span className="text-xs text-white/50">
                {selectedCrateAssets.length} asset{selectedCrateAssets.length !== 1 ? 's' : ''} inside
              </span>
            </div>
            <button
              onClick={() => setSelectedCrateId(null)}
              className="text-xs text-white/40 hover:text-white px-2 py-1 rounded bg-white/5 hover:bg-white/10"
            >
              Close
            </button>
          </div>

          {selectedCrateAssets.length > 0 ? (
            <div className="space-y-2">
              {selectedCrateAssets.map((asset) => (
                <div
                  key={asset.id}
                  onClick={() => onSelectAsset?.(asset)}
                  className="flex items-center justify-between bg-black/40 border border-white/5 hover:border-blue-500/40 rounded-lg px-3 py-2 cursor-pointer transition"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-white">{asset.sku}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                          asset.criticality === 'CRITICAL'
                            ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                            : 'bg-white/10 text-white/70'
                        }`}
                      >
                        {asset.criticality}
                      </span>
                      {asset.expiry_date && (
                        <span className="text-[10px] text-amber-400/80">exp {asset.expiry_date}</span>
                      )}
                    </div>
                    <div className="text-xs text-white/60 mt-0.5">{asset.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-white">{asset.qty} <span className="text-xs font-normal text-white/50">{asset.unit}</span></div>
                    <div className="text-[10px] text-blue-400 hover:underline">Inspect →</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-xs text-white/40">
              No inventory recorded in crate {selectedCrateId}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
