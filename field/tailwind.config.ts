import type { Config } from 'tailwindcss';

// Polaris Expedition Palette (same tokens as website/ + hq-dashboard/), as CSS
// variables so the field app can swap Day/Glare ↔ Polar Night at runtime.
const token = (v: string) => `rgb(var(--${v}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Instrument Serif"', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        canvas: token('canvas'),
        surface: token('surface'),
        structure: token('structure'),
        ink: token('ink'),
        slate: token('slate'),
        cobalt: token('cobalt'),
        phosphor: token('phosphor'),
        flare: token('flare'),
        caution: token('caution'),
      },
      spacing: { tap: 'var(--tap)' },
      minHeight: { tap: 'var(--tap)' },
      minWidth: { tap: 'var(--tap)' },
      boxShadow: {
        panel: '4px 4px 0 0 rgb(var(--structure))',
        'panel-sm': '2px 2px 0 0 rgb(var(--structure))',
      },
      keyframes: {
        blink: { '50%': { opacity: '0.25' } },
        sweep: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(100%)' } },
      },
      animation: {
        blink: 'blink 1.1s steps(2) infinite',
        sweep: 'sweep 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};
export default config;
