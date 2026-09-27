'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useField } from '../../lib/field-context';
import { CommsStrip } from '../../components/shell/CommsStrip';
import { NavRail, BottomBar } from '../../components/shell/Nav';
import { DrillBanner, EmergencyBanner } from '../../components/shell/Banners';
import { Toaster } from '../../components/shell/Toaster';
import { SosSheet } from '../../components/shell/SosSheet';
import { AssetSheet } from '../../components/shell/AssetSheet';
import { useScanWedge } from '../../components/shell/ScanWedge';
import { ErrorBoundary } from '../../components/ErrorBoundary';

export default function FieldShell({ children }: { children: React.ReactNode }) {
  const { session } = useField();
  const router = useRouter();
  useScanWedge();

  useEffect(() => {
    // Session is read from storage in an effect; give it one tick before redirecting.
    const t = setTimeout(() => { if (!session) router.replace('/login'); }, 50);
    return () => clearTimeout(t);
  }, [session, router]);

  if (!session) {
    return <div className="grid min-h-dvh place-items-center font-mono text-sm text-slate">Loading station…</div>;
  }

  return (
    <div className="min-h-dvh">
      <CommsStrip />
      <DrillBanner />
      <EmergencyBanner />
      <div className="flex">
        <NavRail />
        <main className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
          <ErrorBoundary label="This screen">{children}</ErrorBoundary>
        </main>
      </div>
      <BottomBar />
      <SosSheet />
      <AssetSheet />
      <Toaster />
    </div>
  );
}
