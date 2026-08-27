'use client';
import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';

const cratePositions: Record<string, [number, number, number]> = {
  'C1-K1': [-1, -0.5, -1],
  'C1-K2': [1, -0.5, -1],
  'C2-K1': [-1, 0.5, -1],
  'C2-K2': [1, 0.5, -1],
  'C2-K3': [0, 1.5, -1],
  'C3-K1': [-1, -0.5, 1],
  'C3-K2': [1, -0.5, 1],
};

function Crate({ id, position, asset, isHL, onClick }: { id: string, position: [number, number, number], asset: any, isHL: boolean, onClick: (id: string) => void }) {
  const color = isHL ? '#f59e0b' : asset ? '#059669' : '#333333';
  return (
    <group position={position} onClick={(e) => { e.stopPropagation(); onClick(id); }}>
      <mesh>
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <meshStandardMaterial color={color} opacity={0.9} transparent />
      </mesh>
      <Text position={[0, 0, 0.51]} fontSize={0.2} color="white" anchorX="center" anchorY="middle">
        {id}
      </Text>
      {asset && (
        <Text position={[0, -0.2, 0.51]} fontSize={0.1} color="white" anchorX="center" anchorY="middle">
          {`${asset.qty} ${asset.unit}`}
        </Text>
      )}
    </group>
  );
}

export function Container3D({ assets, highlight, onPick }: { assets: any[]; highlight: string | null; onPick?: (id: string) => void }) {
  const byId = new Map(assets.map(a => [a.crate_id, a]));
  return (
    <div className="w-full h-64 bg-black/40 rounded-xl overflow-hidden relative border border-white/10">
      <div className="absolute top-2 left-2 z-10 text-[10px] text-white/50 pointer-events-none">Interactive 3D X-Ray (Drag to rotate)</div>
      <Canvas camera={{ position: [0, 2, 6], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[10, 10, 10]} intensity={0.8} />
        <OrbitControls enableZoom={true} />
        {/* ISO-20 Container Outline */}
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[3.2, 3.2, 3.2]} />
          <meshBasicMaterial color="#ffffff" wireframe opacity={0.15} transparent />
        </mesh>
        {Object.entries(cratePositions).map(([id, pos]) => (
          <Crate 
            key={id} 
            id={id} 
            position={pos} 
            asset={byId.get(id)} 
            isHL={highlight === id} 
            onClick={onPick || (() => {})} 
          />
        ))}
      </Canvas>
    </div>
  );
}
