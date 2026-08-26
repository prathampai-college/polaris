import './globals.css';
export const metadata = { title: 'POLARIS Field — Bharati', description: 'Offline-first polar logistics' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><link rel="manifest" href="/manifest.json" /><meta name="theme-color" content="#0B1220" /></head>
      <body>{children}</body>
    </html>
  );
}
