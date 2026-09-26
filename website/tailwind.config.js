/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Instrument Serif', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // The Polaris Expedition Palette
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
        marquee: 'marquee 26s linear infinite',
        'marquee-rev': 'marquee-rev 30s linear infinite',
        blink: 'blink 1.1s steps(2) infinite',
        tick: 'tick 1.6s ease-out infinite',
        'flow-right': 'flowRight 1.8s linear infinite',
      },
      keyframes: {
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        'marquee-rev': { '0%': { transform: 'translateX(-50%)' }, '100%': { transform: 'translateX(0)' } },
        blink: { '50%': { opacity: '0.2' } },
        tick: { '0%': { opacity: '1' }, '100%': { opacity: '0' } },
        flowRight: {
          '0%': { left: '0%', opacity: '0' },
          '10%': { opacity: '1' },
          '85%': { opacity: '1' },
          '100%': { left: '100%', opacity: '0' },
        },
      },
      boxShadow: {
        // hard, offset "instrument panel" shadow — no blur, no glow
        panel: '4px 4px 0 0 #101928',
        'panel-sm': '2px 2px 0 0 #101928',
      },
      borderRadius: {
        none: '0px',
      },
    },
  },
  plugins: [],
}
