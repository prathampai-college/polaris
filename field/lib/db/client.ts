'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkerApi, SyncInfo } from './worker';
import type { Ctx } from './core';

type Strip<F> = F extends (db: any, ctx: any, ...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;
export type Api = { [K in keyof WorkerApi]: Strip<WorkerApi[K]> };
export type { SyncInfo };
export type WorkerEvent =
  | { type: 'ready'; storage: 'opfs' | 'memory'; reason: string | null }
  | { type: 'fatal'; error: string }
  | { type: 'changed'; tables: string[] }
  | { type: 'sync'; info: SyncInfo }
  | { type: 'push'; entity: string; id: string; patch: Record<string, unknown> };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const listeners = new Set<(e: WorkerEvent) => void>();

function boot(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent) => {
    const m = ev.data;
    if (m.type === 'result') {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.ok) p?.resolve(m.result); else p?.reject(new Error(m.error));
      return;
    }
    // a dead DB worker must fail every waiting call, not leave screens spinning
    if (m.type === 'fatal') failAll(m.error);
    for (const l of listeners) l(m as WorkerEvent);
  };
  worker.onerror = (e) => failAll(e.message || 'DB worker crashed');
  return worker;
}

function failAll(error: string) {
  for (const p of pending.values()) p.reject(new Error(error));
  pending.clear();
}

const RPC_TIMEOUT_MS = 20_000;

/** Typed RPC into the DB worker: `db.recordTx({...})`. Session ctx is applied worker-side. */
export const db = new Proxy({} as Api, {
  get: (_t, method: string) => (...args: unknown[]) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { if (pending.delete(id)) reject(new Error(`DB call ${method} timed out`)); }, RPC_TIMEOUT_MS);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    boot().postMessage({ type: 'call', id, method, args });
  }),
});

export function setSession(session: { ctx: Ctx; gatewayUrl: string } | null) {
  boot().postMessage({ type: 'session', session });
}

export function onWorker(l: (e: WorkerEvent) => void): () => void {
  boot();
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/**
 * Re-runs `fn` whenever the worker reports a change to any of `tables` — local
 * data is event-driven, no polling. `deps` re-run it too (e.g. station switch).
 */
export function useLiveQuery<T>(fn: () => Promise<T>, tables: string[], deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const gen = useRef(0);

  const reload = useCallback(() => {
    const g = ++gen.current;
    fnRef.current().then(
      (d) => { if (g === gen.current) { setData(d); setError(null); } },
      (e: Error) => { if (g === gen.current) setError(e.message); },
    );
  }, []);

  useEffect(() => {
    reload();
    const key = tables.join(',');
    return onWorker((e) => {
      if (e.type === 'changed' && (e.tables.includes('*') || e.tables.some((t) => key.split(',').includes(t)))) reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, tables.join(','), ...deps]);

  return { data, error, loading: data === undefined && !error, reload };
}
