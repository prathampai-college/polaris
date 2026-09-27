import './globals.css';
import { ErrorBoundary } from '../components/ErrorBoundary';

export const metadata = { title: 'POLARIS HQ — NCPOR Command', description: 'HQ Command — Fleet, Forecast & Indent Workbench' };

// Fonts loaded via runtime <link> tags, not next/font: next/font fetches Google
// Fonts at BUILD time, which is fragile in sandboxed Docker builds with no
// egress to fonts.googleapis.com. Matches the pattern already used in website/.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-dvh font-sans">
        <ErrorBoundary label="HQ dashboard">{children}</ErrorBoundary>
      </body>
    </html>
  );
}
