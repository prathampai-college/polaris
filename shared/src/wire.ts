export const MAX_WIRE_SIZE = 2048;

/** Shared wire budget check — single source for gateway, HQ, field. */
export function assertWireSize(wire: Uint8Array): void {
  if (wire.length > MAX_WIRE_SIZE) throw new Error(`frame >${MAX_WIRE_SIZE} (got ${wire.length})`);
}
