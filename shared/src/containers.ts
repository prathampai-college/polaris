export const CONTAINER_SPECS: Record<string, { name: string; type: string; tempZone: string; color: string; crates: string[] }> = {
  ALL: { name: 'All Stations / Overview', type: 'Fleet View', tempZone: 'Multi-Zone', color: '#38BDF8', crates: ['C1-K1','C1-K2','C2-K1','C2-K2','C2-K3','C3-K1','C3-K2','C4-K1','C4-K2','C5-K1','C5-K2','C6-K1'] },
  C1: { name: 'C1 — ISO 20ft Ambient Bay', type: 'ISO_20ft', tempZone: 'AMBIENT (+15°C)', color: '#3B82F6', crates: ['C1-K1', 'C1-K2'] },
  C2: { name: 'C2 — ColdStore Medical & Food', type: 'ColdStore', tempZone: 'CRYOGENIC (-20°C)', color: '#06B6D4', crates: ['C2-K1', 'C2-K2', 'C2-K3'] },
  C3: { name: 'C3 — Hazmat & Spares Bay', type: 'Hazmat', tempZone: 'HAZMAT / VENTILATED', color: '#F59E0B', crates: ['C3-K1', 'C3-K2'] },
  C4: { name: 'C4 — Maitri Ambient ISO-20ft', type: 'ISO_20ft', tempZone: 'AMBIENT (+10°C)', color: '#3B82F6', crates: ['C4-K1', 'C4-K2'] },
  C5: { name: 'C5 — Maitri ColdStore', type: 'ColdStore', tempZone: 'CRYOGENIC (-20°C)', color: '#06B6D4', crates: ['C5-K1', 'C5-K2'] },
  C6: { name: 'C6 — Himadri Arctic Supply Bay', type: 'ISO_20ft', tempZone: 'AMBIENT (+5°C)', color: '#8B5CF6', crates: ['C6-K1'] },
};

export const CRATE_COORDS: Record<string, [number, number, number]> = {
  'C1-K1': [-1.1, -0.4, -0.6],
  'C1-K2': [1.1, -0.4, -0.6],
  'C2-K1': [-1.1, 0.6, -0.6],
  'C2-K2': [1.1, 0.6, -0.6],
  'C2-K3': [0.0, 0.6, 0.7],
  'C3-K1': [-1.1, -0.4, 0.7],
  'C3-K2': [1.1, -0.4, 0.7],
  'C4-K1': [-1.0, -0.3, 0],
  'C4-K2': [1.0, -0.3, 0],
  'C5-K1': [-1.0, 0.5, 0],
  'C5-K2': [1.0, 0.5, 0],
  'C6-K1': [0.0, 0.0, 0],
};
