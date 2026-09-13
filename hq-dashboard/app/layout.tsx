import './globals.css';
import { ErrorBoundary } from '../components/ErrorBoundary';
export const metadata = { title: 'POLARIS HQ — NCPOR Command', description: 'HQ Command — Fleet, Forecast & Indent Workbench' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body className="min-h-dvh"><ErrorBoundary label="HQ dashboard">{children}</ErrorBoundary></body></html>;
}
