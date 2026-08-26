// @ts-nocheck
import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { polar: { bg: '#0B1220', card: '#121E35', accent: '#3B82F6', danger: '#EF4444', success: '#22C55E' } }
    }
  },
  plugins: []
};
export default config;
