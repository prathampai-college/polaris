export const TELEMETRY_CALM = {
  temp_outside: -15,
  wind_speed: 5,
  pressure: 1013,
  dg_load: 0.7,
} as const;

export const TELEMETRY_BLIZZARD = {
  temp_outside: -38,
  wind_speed: 22,
  pressure: 960,
  dg_load: 0.9,
} as const;
