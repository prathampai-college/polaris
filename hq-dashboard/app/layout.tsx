import './globals.css';
export const metadata = { title: 'POLARIS HQ — NCPOR Command', description: 'HQ Command — Fleet, Forecast & Indent Workbench' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body className="min-h-dvh">{children}</body></html>;
}
