'use client';
import { useEffect } from 'react';
import { useField } from '../../lib/field-context';
import { db } from '../../lib/db/client';
import { haptic } from '../../lib/utils';

/**
 * Rugged barcode scanners type the code as keystrokes ending in Enter, far faster
 * than a human. Catch those bursts anywhere (outside text fields) and open the asset.
 */
export function useScanWedge() {
  const { openAsset, toast, session } = useField();
  useEffect(() => {
    if (!session) return;
    let buf = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const now = performance.now();
      if (now - last > 60) buf = '';
      last = now;
      if (e.key === 'Enter') {
        const code = buf;
        buf = '';
        if (code.length < 4) return;
        e.preventDefault();
        void db.findByCode(code).then((a) => {
          if (a) { haptic(30); openAsset(a.id); } else { haptic([80, 60, 80]); toast(`No item with code ${code} on this tablet`, 'alert'); }
        });
      } else if (e.key.length === 1) {
        buf += e.key;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openAsset, toast, session]);
}
