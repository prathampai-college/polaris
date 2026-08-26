export const SEED_STATIONS = [
  { id: 'ST-BHARATI', name: 'Bharati', location: '69°24′S 76°11′E', winter_crew_count: 24 },
  { id: 'ST-MAITRI', name: 'Maitri', location: '70°45′S 11°44′E', winter_crew_count: 25 },
  { id: 'ST-HIMADRI', name: 'Himadri', location: '78°55′N 11°56′E', winter_crew_count: 8 },
] as const;

export const SEED_CONTAINERS = [
  { id: 'C1', station_id: 'ST-BHARATI', type: 'ISO_20ft', position_2d: 'A1' },
  { id: 'C2', station_id: 'ST-BHARATI', type: 'ColdStore', position_2d: 'A2' },
  { id: 'C3', station_id: 'ST-BHARATI', type: 'Hazmat', position_2d: 'B1' },
] as const;

export const SEED_CRATES = [
  { id: 'C1-K1', container_id: 'C1', coords: JSON.stringify({x:0,y:0}), temp_zone: 'AMBIENT' },
  { id: 'C1-K2', container_id: 'C1', coords: JSON.stringify({x:1,y:0}), temp_zone: 'AMBIENT' },
  { id: 'C2-K1', container_id: 'C2', coords: JSON.stringify({x:0,y:1}), temp_zone: 'COLD' },
  { id: 'C2-K2', container_id: 'C2', coords: JSON.stringify({x:1,y:1}), temp_zone: 'COLD' },
  { id: 'C2-K3', container_id: 'C2', coords: JSON.stringify({x:0,y:2}), temp_zone: 'COLD' },
  { id: 'C3-K1', container_id: 'C3', coords: JSON.stringify({x:0,y:0}), temp_zone: 'AMBIENT' },
  { id: 'C3-K2', container_id: 'C3', coords: JSON.stringify({x:0,y:1}), temp_zone: 'HAZMAT' },
] as const;

export const SEED_ASSETS = [
  { id: 'A1', sku: 'FUEL-DIESEL-001', name: 'Diesel (Winter Grade)', category: 'FUEL_DIESEL', qty: 4200, unit: 'L', expiry_date: null, criticality: 'CRITICAL', crate_id: 'C1-K1', barcode: 'FUEL-DIESEL-001' },
  { id: 'A2', sku: 'FUEL-KERO-JP8-002', name: 'Kerosene JP-8', category: 'FUEL_KEROSENE', qty: 1800, unit: 'L', expiry_date: null, criticality: 'CRITICAL', crate_id: 'C1-K2', barcode: 'FUEL-KERO-JP8-002' },
  { id: 'A3', sku: 'O2-CYL-47L-003', name: 'Oxygen Cylinder 47L', category: 'OXYGEN', qty: 24, unit: 'cyl', expiry_date: '2026-09-15', criticality: 'CRITICAL', crate_id: 'C2-K1', barcode: 'O2-CYL-47L-003' },
  { id: 'A4', sku: 'RATION-FD-30D-004', name: 'Freeze-Dried Rations (30-day pack)', category: 'FOOD', qty: 90, unit: 'packs', expiry_date: '2027-06-01', criticality: 'HIGH', crate_id: 'C2-K2', barcode: 'RATION-FD-30D-004' },
  { id: 'A5', sku: 'MED-ANTIBIOTIC-005', name: 'Antibiotic Kit (Amoxicillin)', category: 'MEDICAL', qty: 12, unit: 'kits', expiry_date: '2026-09-20', criticality: 'CRITICAL', crate_id: 'C2-K3', barcode: 'MED-ANTIBIOTIC-005' },
  { id: 'A6', sku: 'MED-TRAUMA-006', name: 'Trauma Kit (Type A)', category: 'MEDICAL', qty: 6, unit: 'kits', expiry_date: '2026-10-10', criticality: 'CRITICAL', crate_id: 'C2-K3', barcode: 'MED-TRAUMA-006' },
  { id: 'A7', sku: 'SPARE-BRG-6205-007', name: 'DG Bearing 6205-2RS', category: 'SPARES_DG', qty: 8, unit: 'pcs', expiry_date: null, criticality: 'HIGH', crate_id: 'C3-K1', barcode: 'SPARE-BRG-6205-007' },
  { id: 'A8', sku: 'SPARE-FILTER-FUEL-008', name: 'DG Fuel Filter (Fleetguard)', category: 'SPARES_DG', qty: 14, unit: 'pcs', expiry_date: null, criticality: 'HIGH', crate_id: 'C3-K1', barcode: 'SPARE-FILTER-FUEL-008' },
  { id: 'A9', sku: 'SPARE-HVAC-FAN-009', name: 'HVAC Blower Motor', category: 'SPARES_HVAC', qty: 2, unit: 'pcs', expiry_date: null, criticality: 'HIGH', crate_id: 'C3-K2', barcode: 'SPARE-HVAC-FAN-009' },
  { id: 'A10', sku: 'SCI-ICE-CORE-010', name: 'Ice Core Drill Bit', category: 'SCIENTIFIC', qty: 4, unit: 'pcs', expiry_date: null, criticality: 'LOW', crate_id: 'C3-K2', barcode: 'SCI-ICE-CORE-010' },
] as const;
