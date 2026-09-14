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
        ink: '#020a12',
        abyss: '#050e1a',
        panel: '#0b1e33',
      },
      animation: {
        marquee: 'marquee 26s linear infinite',
        'marquee-rev': 'marquee-rev 30s linear infinite',
        float: 'float 7s ease-in-out infinite',
        'pulse-ring': 'pulseRing 2.4s ease-out infinite',
        shimmer: 'shimmer 2.8s linear infinite',
        blink: 'blink 1.1s steps(2) infinite',
      },
      keyframes: {
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        'marquee-rev': { '0%': { transform: 'translateX(-50%)' }, '100%': { transform: 'translateX(0)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        pulseRing: { '0%': { transform: 'scale(0.7)', opacity: '0.7' }, '100%': { transform: 'scale(1.8)', opacity: '0' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        blink: { '50%': { opacity: '0.2' } },
      },
      boxShadow: {
        glow: '0 0 40px rgba(34,240,216,0.25)',
        card: '0 20px 60px rgba(0,0,0,0.5)',
      },
    },
  },
  plugins: [],
}
