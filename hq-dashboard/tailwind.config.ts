import type { Config } from 'tailwindcss';

// The Polaris Expedition Palette — same tokens as website/tailwind.config.js.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Instrument Serif', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        canvas: '#EEF2F6',    // Glacial Sheet
        surface: '#FFFFFF',   // Lab Pure White
        structure: '#101928', // Technical Navy-Charcoal
        ink: '#0B0F19',       // Deep Cold Carbon
        slate: '#5B6776',     // Radar Slate
        cobalt: '#0047FF',    // Antarctic Cobalt
        phosphor: '#00C2FF',  // Cryo Phosphor
        flare: '#FF4800',     // Hazard Flare
      },
      animation: {
        blink: 'blink 1.1s steps(2) infinite',
      },
      keyframes: {
        blink: { '50%': { opacity: '0.2' } },
      },
      boxShadow: {
        panel: '4px 4px 0 0 #101928',
        'panel-sm': '2px 2px 0 0 #101928',
      },
      borderRadius: {
        none: '0px',
      },
    },
  },
  plugins: [],
};
export default config;
