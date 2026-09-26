// The Polaris Expedition Palette — single source of truth.
// Tailwind classes (bg-canvas, text-cobalt, …) read theirs from tailwind.config.js;
// this file exists because canvas 2D draw calls can't reach Tailwind classes.
export const PALETTE = {
  canvas: '#EEF2F6',    // Glacial Sheet — page background
  surface: '#FFFFFF',   // Lab Pure White — cards/panels
  structure: '#101928', // Technical Navy-Charcoal — hairlines, crosshairs, ticks
  ink: '#0B0F19',       // Deep Cold Carbon — primary text
  slate: '#5B6776',     // Radar Slate — secondary text/metadata
  cobalt: '#0047FF',    // Antarctic Cobalt — primary accent / active state
  phosphor: '#00C2FF',  // Cryo Phosphor — live telemetry only
  flare: '#FF4800',     // Hazard Flare — alert/critical only
} as const;
