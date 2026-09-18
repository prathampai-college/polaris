export type StationName = 'Bharati' | 'Maitri' | 'Himadri';
export type ContainerType = 'ISO_20ft' | 'ColdStore' | 'Hazmat';
export type AssetCategory = 'FUEL_DIESEL' | 'FUEL_KEROSENE' | 'OXYGEN' | 'FOOD' | 'MEDICAL' | 'SPARES_DG' | 'SPARES_HVAC' | 'SCIENTIFIC';
export type Criticality = 'CRITICAL' | 'HIGH' | 'LOW';
export type TxnType = 'IN' | 'OUT' | 'CONSUME' | 'ADJUST';
export type IndentStatus = 'DRAFT' | 'APPROVED' | 'DISPATCHED' | 'RECEIVED';
export type IndentUrgency = 'LOW' | 'MEDIUM' | 'CRITICAL';
export type SyncStatus = 'PENDING' | 'SYNCED' | 'FAILED';
export type OutboxOp = 'UPSERT' | 'DELETE' | 'CONSUME' | 'IN' | 'OUT' | 'ADJUST';
export type OutboxStatus = 'PENDING' | 'SENT' | 'ACKED' | 'FAILED' | 'BUNDLED';
export type UserRole = 'NCPOR_ADMIN' | 'HQ_LOGISTICS' | 'DISPATCH' | 'STATION_LEAD' | 'FIELD_OP' | 'VIEWER';

export interface AuthPayload {
  sub: string;
  role: UserRole;
  station_id: string;
  device_id: string;
  iat: number;
  exp: number;
}

export interface Station { id: string; name: StationName; location: string; winter_crew_count: number; }
export interface Container { id: string; station_id: string; type: ContainerType; position_2d: string; }
export interface Crate { id: string; container_id: string; coords: string; temp_zone: string; }
export interface Asset { id: string; sku: string; name: string; category: AssetCategory; qty: number; unit: string; expiry_date: string | null; criticality: Criticality; crate_id: string; barcode: string; updated_at?: string; version?: number; }
export interface Transaction { id: string; asset_id: string; type: TxnType; qty_delta: number; actor_id: string; ts: string; sync_status: SyncStatus; }
export interface Indent { id: string; station_id: string; asset_id: string; qty_requested: number; urgency: IndentUrgency; status: IndentStatus; created_by: string; created_at: string; }
export interface Telemetry { ts: string; station_id: string; temp_outside: number; wind_speed: number; pressure: number; dg_load: number; }
export interface AuditLog { id: string; actor_id: string; action: string; entity: string; before: string | null; after: string | null; ts: string; }
export interface OutboxRow { ulid: string; device_id: string; entity: string; entity_id: string; op: OutboxOp; patch: Uint8Array; base_version: number; retry_count: number; created_at: string; status: OutboxStatus; }
export interface SyncState { device_id: string; last_acked_ulid: string | null; last_server_version: number; vector_clock?: VectorClock | null; }

export type PersonnelStatus = 'ON_STATION' | 'FIELD_SORTIE' | 'IN_TRANSIT' | 'EVACUATED';
export type SortieSafetyStatus = 'PLANNED' | 'ACTIVE' | 'RETURNED' | 'OVERDUE' | 'EMERGENCY';
export type EmergencyType = 'SOS_MEDICAL' | 'SOS_FIRE' | 'SOS_WHITEOUT' | 'SOS_POWER' | 'SOS_VEHICLE';
export type EmergencyStatus = 'ACTIVE' | 'ACK' | 'RESPONDING' | 'RESOLVED';

export interface Personnel {
  id: string;
  station_id: string;
  name: string;
  role: string;
  blood_group: string;
  emergency_contact: string;
  status: PersonnelStatus;
}

export interface FieldSortie {
  id: string;
  station_id: string;
  lead_personnel_id: string;
  destination: string;
  departure_time: string;
  expected_return_time: string;
  actual_return_time?: string | null;
  safety_status: SortieSafetyStatus;
}

export interface Emergency {
  id: string;
  station_id: string;
  type: EmergencyType;
  reported_by: string;
  status: EmergencyStatus;
  ts: string;
  location_coord?: string | null;
  assignee?: string | null;
  sortie_id?: string | null;
}

export type ExpeditionProgram = 'ANTARCTIC' | 'ARCTIC';
export type ExpeditionStatus = 'PLANNED' | 'STUFFING' | 'IN_TRANSIT' | 'DELIVERED' | 'WINTER_OVER' | 'COMPLETE';
export type LegMode = 'SEA' | 'AIR' | 'TRAVERSE';
export type LegStatus = 'PLANNED' | 'DEPARTED' | 'ARRIVED' | 'DELAYED';
export type ManifestStage = 'GOA' | 'MUMBAI' | 'CAPETOWN' | 'VESSEL' | 'STATION' | 'CRATE';
export type TempZone = 'AMBIENT' | 'COLD' | 'HAZMAT';

export interface Expedition {
  id: string;
  program: ExpeditionProgram;
  name: string;
  season: string;
  status: ExpeditionStatus;
  created_by?: string;
  created_at?: string;
}

export interface VoyageLeg {
  id: string;
  expedition_id: string;
  seq: number;
  from_point: string;
  to_point: string;
  mode: LegMode;
  vessel_imo?: string | null;
  eta_depart?: string | null;
  eta_arrive?: string | null;
  status: LegStatus;
}

export interface ManifestRow {
  id: string;
  expedition_id: string;
  owner_org: string;
  project_code: string;
  destination_station: string;
  sku?: string | null;
  description: string;
  qty: number;
  unit: string;
  weight_kg?: number | null;
  hazmat_class?: string | null;
  temp_zone: TempZone;
  customs_status: string;
  biosecurity_status: string;
  labelling_code: string;
  container_id?: string | null;
  crate_id?: string | null;
  stage: ManifestStage;
}

export interface DecisionOverride {
  id: string;
  ref_type: 'EMERGENCY' | 'INDENT' | 'SORTIE';
  ref_id: string;
  station_id: string;
  actor_id: string;
  stated_risk?: string | null;
  action: string;
  ts: string;
}

export type VectorClock = Record<string, number>;

export interface DeltaFrame {
  type?: 'DELTA';
  ulid: string;
  device_id: string;
  entity: string;
  entity_id: string;
  op: OutboxOp;
  patch: Record<string, unknown>;
  base_version: number;
  ts: string;
  vector_clock?: VectorClock;
  local_coord?: [number, number, number];
}

export interface AckFrame {
  type?: 'ACK';
  ulid: string;
  status: 'APPLIED' | 'DEDUPED' | 'CONFLICT_CRITICAL' | 'FAILED';
  server_version?: number;
  message?: string;
}

export interface DownstreamDeltaFrame {
  type: 'DOWNSTREAM_DELTA';
  ulid: string;
  station_id: string;
  entity: 'indents' | 'assets' | 'telemetry' | 'vessels' | 'personnel' | 'field_sorties' | 'emergencies' | 'expeditions' | 'voyage_legs' | 'manifests';
  entity_id: string;
  op: 'UPSERT' | 'STATUS_CHANGE' | 'DELETE';
  patch: Record<string, unknown>;
  ts: string;
  vector_clock?: VectorClock;
}

export interface SyncInitFrame {
  type: 'SYNC_INIT';
  device_id: string;
  station_id: string;
  last_acked_ulid?: string | null;
}

export interface SyncInitRespFrame {
  type: 'SYNC_INIT_RESP';
  station_id: string;
  server_time: string;
  indents: Indent[];
  bundles?: unknown[];
}

export type WireFrame = DeltaFrame | AckFrame | DownstreamDeltaFrame | SyncInitFrame | SyncInitRespFrame;

