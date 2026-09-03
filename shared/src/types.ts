export type StationName = 'Bharati' | 'Maitri' | 'Himadri';
export type ContainerType = 'ISO_20ft' | 'ColdStore' | 'Hazmat';
export type AssetCategory = 'FUEL_DIESEL' | 'FUEL_KEROSENE' | 'OXYGEN' | 'FOOD' | 'MEDICAL' | 'SPARES_DG' | 'SPARES_HVAC' | 'SCIENTIFIC';
export type Criticality = 'CRITICAL' | 'HIGH' | 'LOW';
export type TxnType = 'IN' | 'OUT' | 'CONSUME' | 'ADJUST';
export type IndentStatus = 'DRAFT' | 'APPROVED' | 'DISPATCHED' | 'RECEIVED';
export type IndentUrgency = 'LOW' | 'MEDIUM' | 'CRITICAL';
export type SyncStatus = 'PENDING' | 'SYNCED' | 'FAILED';
export type OutboxOp = 'UPSERT' | 'DELETE' | 'CONSUME' | 'IN' | 'OUT' | 'ADJUST';
export type OutboxStatus = 'PENDING' | 'SENT' | 'ACKED' | 'FAILED';
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
export interface SyncState { device_id: string; last_acked_ulid: string | null; last_server_version: number; }

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
  entity: 'indents' | 'assets' | 'telemetry' | 'vessels';
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

