// @ts-nocheck
import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: { extend: { colors: { polar: { bg: '#0B1220', card: '#121E35', accent: '#3B82F6', danger: '#EF4444', success: '#22C55E' },
    night: { bg: '#060A13', card: '#0C1626' }, aurora: { teal: '#2DD4BF', dim: '#14B8A6' }, ice: { cyan: '#22D3EE' }, signal: { amber: '#FBBF24' } } } },
  plugins: []
};
export default config;
