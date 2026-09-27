'use client';
import { X } from 'lucide-react';
import { useField } from '../../lib/field-context';
import { cn } from '../../lib/utils';

export function Toaster() {
  const { toasts, dismiss } = useField();
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[76px] z-[60] flex flex-col items-end gap-2 lg:bottom-4 lg:left-auto lg:right-4 lg:w-[420px]">
      {toasts.map((t) => (
        <div key={t.id} role={t.tone === 'alert' ? 'alert' : 'status'} aria-live={t.tone === 'alert' ? 'assertive' : 'polite'}
          className={cn('pointer-events-auto flex w-full items-start gap-3 border border-structure px-4 py-3 shadow-panel-sm',
            t.tone === 'alert' ? 'bg-flare text-white' : t.tone === 'ok' ? 'bg-ink text-canvas' : 'bg-surface text-ink')}>
          <p className="flex-1 text-sm font-medium">{t.msg}</p>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-my-1 -mr-2 grid min-h-[36px] min-w-[36px] place-items-center opacity-80 hover:opacity-100">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
