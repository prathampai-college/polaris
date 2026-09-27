import './globals.css';
// Self-hosted fonts: bundled at build, so the app renders correctly with no internet at a polar station.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import type { Metadata, Viewport } from 'next';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { FieldProvider } from '../lib/field-context';
import { SwRegister } from '../components/shell/SwRegister';

export const metadata: Metadata = {
  title: 'POLARIS Field',
  description: 'Offline-first polar station logistics — stock, muster, SOS and DTN sync.',
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
};

// No maximum-scale: pinch-zoom stays available (gloved hands, small print on labels).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#101928' };

// Applies saved theme/glove prefs before first paint — no light→dark flash in a dark hut.
const PREFS_SCRIPT = `try{var p=JSON.parse(localStorage.getItem('polaris_prefs')||'{}');var d=document.documentElement;if(p.theme)d.dataset.theme=p.theme;if(p.glove)d.classList.add('glove');if(p.bigText)d.classList.add('bigtext')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <ErrorBoundary label="Field app">
          <FieldProvider>{children}</FieldProvider>
        </ErrorBoundary>
        <SwRegister />
      </body>
    </html>
  );
}
