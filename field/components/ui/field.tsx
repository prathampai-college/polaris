'use client';
import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

const control = 'min-h-tap w-full border border-structure bg-surface px-3 text-base text-ink placeholder:text-slate/70 focus:border-cobalt focus:outline-none disabled:opacity-50';

/** Label + control + hint, linked by id so screen readers and taps on the label work. */
export function Field({ label, hint, error, children, className }: { label: string; hint?: React.ReactNode; error?: string | null; children: (id: string) => React.ReactNode; className?: string }) {
  const id = React.useId();
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="eyebrow block">{label}</label>
      {children(id)}
      {error ? <p className="text-sm text-flare">{error}</p> : hint ? <p className="text-xs text-slate">{hint}</p> : null}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(control, className)} {...props} />
));
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(control, 'font-mono text-sm', className)} {...props} />
));
Select.displayName = 'Select';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(control, 'py-2 font-mono text-sm', className)} {...props} />
));
Textarea.displayName = 'Textarea';

/** Qty stepper — glove-sized −/+ with direct numeric entry. */
export function Stepper({ value, onChange, min = 1, max = 99999, step = 1, unit, id }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; unit?: string; id?: string }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
  return (
    <div className="flex w-full items-stretch border border-structure bg-surface">
      <button type="button" aria-label="Decrease" onClick={() => onChange(clamp(value - step))} disabled={value <= min} className="grid min-h-tap min-w-tap place-items-center border-r border-structure text-ink hover:bg-structure hover:text-canvas disabled:opacity-30">
        <Minus size={20} />
      </button>
      <input
        id={id}
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="num min-h-tap min-w-0 flex-1 bg-transparent text-center font-mono text-xl font-semibold text-ink focus:outline-none"
      />
      {unit && <span className="grid place-items-center pr-3 font-mono text-sm text-slate">{unit}</span>}
      <button type="button" aria-label="Increase" onClick={() => onChange(clamp(value + step))} disabled={value >= max} className="grid min-h-tap min-w-tap place-items-center border-l border-structure text-ink hover:bg-structure hover:text-canvas disabled:opacity-30">
        <Plus size={20} />
      </button>
    </div>
  );
}

/** Segmented single-choice control (tx type, urgency, …). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; tone?: 'flare' }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex border border-structure">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-h-tap flex-1 border-r border-structure px-2 font-mono text-xs font-semibold uppercase tracking-[0.06em] last:border-r-0',
              on ? (o.tone === 'flare' ? 'bg-flare text-white' : 'bg-ink text-canvas') : 'bg-surface text-slate hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-tap w-full items-center justify-between gap-4 border border-structure bg-surface px-4 py-2 text-left hover:border-cobalt">
      <span>
        <span className="block font-mono text-sm font-semibold text-ink">{label}</span>
        {description && <span className="block text-xs text-slate">{description}</span>}
      </span>
      <span aria-hidden className={cn('relative h-7 w-12 shrink-0 border border-structure transition-colors', checked ? 'bg-cobalt' : 'bg-canvas')}>
        <span className={cn('absolute top-0.5 h-5 w-5 border border-structure bg-surface transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  );
}
