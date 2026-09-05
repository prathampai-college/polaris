/** Station scoping — single source for field + hq-dashboard asset filtering. */
export function filterByStation<T extends { station_id?: string; crate_id?: string }>(
  assets: T[],
  stationId: string,
  stationCrates?: string[]
): T[] {
  if (!assets?.length) return [];
  // Prefer station_id when available (HQ GET /assets parity)
  if (assets.some(a => a.station_id)) return assets.filter(a => a.station_id === stationId);
  // Fallback crate_id list (field offline)
  if (stationCrates?.length) {
    const s = new Set(stationCrates);
    return assets.filter(a => a.crate_id && s.has(a.crate_id));
  }
  return assets;
}
