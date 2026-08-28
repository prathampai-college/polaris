import './globals.css';
export const metadata = { title: 'POLARIS Field — Bharati', description: 'Offline-first polar logistics — Arctic Field Manual' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><link rel="manifest" href="/manifest.json" /><meta name="theme-color" content="#080E1E" /><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" /></head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
