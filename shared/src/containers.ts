export const CONTAINER_SPECS: Record<string, { name: string; type: string; tempZone: string; color: string; stationId: string; crates: string[] }> = {
  C1: { name: 'C1 — ISO 20ft Ambient Bay', type: 'ISO_20ft', tempZone: 'AMBIENT (+15°C)', color: '#3B82F6', stationId: 'ST-BHARATI', crates: ['C1-K1', 'C1-K2'] },
  C2: { name: 'C2 — ColdStore Medical & Food', type: 'ColdStore', tempZone: 'CRYOGENIC (-20°C)', color: '#06B6D4', stationId: 'ST-BHARATI', crates: ['C2-K1', 'C2-K2', 'C2-K3'] },
  C3: { name: 'C3 — Hazmat & Spares Bay', type: 'Hazmat', tempZone: 'HAZMAT / VENTILATED', color: '#F59E0B', stationId: 'ST-BHARATI', crates: ['C3-K1', 'C3-K2'] },
  C4: { name: 'C4 — Maitri Ambient ISO-20ft', type: 'ISO_20ft', tempZone: 'AMBIENT (+10°C)', color: '#3B82F6', stationId: 'ST-MAITRI', crates: ['C4-K1', 'C4-K2'] },
  C5: { name: 'C5 — Maitri ColdStore', type: 'ColdStore', tempZone: 'CRYOGENIC (-20°C)', color: '#06B6D4', stationId: 'ST-MAITRI', crates: ['C5-K1', 'C5-K2'] },
  C6: { name: 'C6 — Himadri Arctic Supply Bay', type: 'ISO_20ft', tempZone: 'AMBIENT (+5°C)', color: '#8B5CF6', stationId: 'ST-HIMADRI', crates: ['C6-K1'] },
};

export const STATION_CONTAINERS: Record<string, string[]> = {
  'ST-BHARATI': ['C1', 'C2', 'C3'],
  'ST-MAITRI': ['C4', 'C5'],
  'ST-HIMADRI': ['C6'],
};

export const CRATE_COORDS: Record<string, [number, number, number]> = {
  // C1: Bharati Ambient (2 crates side-by-side, perfectly spaced)
  'C1-K1': [-0.85, -0.2, 0.0],
  'C1-K2': [0.85, -0.2, 0.0],

  // C2: Bharati ColdStore (3 crates: 2 front, 1 center-back, zero collision)
  'C2-K1': [-0.95, -0.2, -0.45],
  'C2-K2': [0.95, -0.2, -0.45],
  'C2-K3': [0.0, -0.2, 0.5],

  // C3: Bharati Hazmat (2 crates side-by-side)
  'C3-K1': [-0.85, -0.2, 0.0],
  'C3-K2': [0.85, -0.2, 0.0],

  // C4: Maitri Ambient (2 crates side-by-side)
  'C4-K1': [-0.85, -0.2, 0.0],
  'C4-K2': [0.85, -0.2, 0.0],

  // C5: Maitri ColdStore (2 crates side-by-side)
  'C5-K1': [-0.85, -0.2, 0.0],
  'C5-K2': [0.85, -0.2, 0.0],

  // C6: Himadri Arctic Bay (1 crate centered)
  'C6-K1': [0.0, -0.2, 0.0],
};
