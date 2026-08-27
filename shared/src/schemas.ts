import { z } from 'zod';

export const stationName = z.enum(['Bharati','Maitri','Himadri']);
export const containerType = z.enum(['ISO_20ft','ColdStore','Hazmat']);
export const assetCategory = z.enum(['FUEL_DIESEL','FUEL_KEROSENE','OXYGEN','FOOD','MEDICAL','SPARES_DG','SPARES_HVAC','SCIENTIFIC']);
export const criticality = z.enum(['CRITICAL','HIGH','LOW']);
export const txnType = z.enum(['IN','OUT','CONSUME','ADJUST']);
export const indentStatus = z.enum(['DRAFT','APPROVED','DISPATCHED','RECEIVED']);
export const indentUrgency = z.enum(['LOW','MEDIUM','CRITICAL']);

export const coordsSchema = z.object({ x: z.number().int().min(0).max(10), y: z.number().int().min(0).max(10) });

export const stationSchema = z.object({
  id: z.string(), name: stationName, location: z.string(), winter_crew_count: z.number().int().min(1)
});
export const containerSchema = z.object({
  id: z.string(), station_id: z.string(), type: containerType, position_2d: z.string()
});
export const crateSchema = z.object({
  id: z.string(), container_id: z.string(), coords: z.string().refine(v=>{ try{ coordsSchema.parse(JSON.parse(v)); return true;}catch{return false;} }, 'coords must be JSON {x,y}'), temp_zone: z.string()
});
export const assetSchema = z.object({
  id: z.string(), sku: z.string(), name: z.string(), category: assetCategory,
  qty: z.number(), unit: z.string(), expiry_date: z.string().nullable(), criticality: criticality,
  crate_id: z.string(), barcode: z.string()
});
export const transactionSchema = z.object({
  id: z.string(), asset_id: z.string(), type: txnType, qty_delta: z.number(), actor_id: z.string(), ts: z.string(), sync_status: z.enum(['PENDING','SYNCED','FAILED'])
});
export const indentSchema = z.object({
  id: z.string(), station_id: z.string(), asset_id: z.string(), qty_requested: z.number().positive(), urgency: indentUrgency, status: indentStatus, created_by: z.string(), created_at: z.string()
});
export const telemetrySchema = z.object({
  ts: z.string(), station_id: z.string(), temp_outside: z.number(), wind_speed: z.number(), pressure: z.number(), dg_load: z.number()
});
export const deltaFrameSchema = z.object({
  type: z.literal('DELTA').optional(),
  ulid: z.string().length(26), device_id: z.string(), entity: z.string(), entity_id: z.string(),
  op: z.enum(['UPSERT','DELETE']), patch: z.record(z.unknown()), base_version: z.number().int().min(0), ts: z.string()
});

export const downstreamDeltaSchema = z.object({
  type: z.literal('DOWNSTREAM_DELTA'),
  ulid: z.string().length(26),
  station_id: z.string(),
  entity: z.enum(['indents', 'assets', 'telemetry']),
  entity_id: z.string(),
  op: z.enum(['UPSERT', 'STATUS_CHANGE', 'DELETE']),
  patch: z.record(z.unknown()),
  ts: z.string()
});

export const syncInitSchema = z.object({
  type: z.literal('SYNC_INIT'),
  device_id: z.string(),
  station_id: z.string(),
  last_acked_ulid: z.string().nullable().optional()
});

