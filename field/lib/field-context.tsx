'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { db, setSession as setWorkerSession, onWorker, useLiveQuery, type SyncInfo } from './db/client';
import { resolveUrls, setToken, load, store, type Urls } from './api';
import { currentSession, login as doLogin, logout as doLogout, stationName, type Role, type Session } from './session';
import { haptic } from './utils';

export interface Prefs { theme: 'day' | 'night'; glove: boolean; bigText: boolean; drill: boolean }
const PREFS = 'polaris_prefs';
const DEFAULT_PREFS: Prefs = { theme: 'day', glove: false, bigText: false, drill: false };

export type Tone = 'info' | 'ok' | 'alert';
export interface Toast { id: number; msg: string; tone: Tone }
export type Storage = { state: 'booting' } | { state: 'opfs' } | { state: 'memory'; reason: string | null } | { state: 'fatal'; reason: string };

interface FieldCtx {
  session: Session | null;
  actorId: string;
  login: (o: { stationId: string; pin: string; role: Role; deviceId: string }) => Promise<Session>;
  logout: (forget?: boolean) => void;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  storage: Storage;
  secure: boolean;
  sync: SyncInfo;
  outbox: { PENDING: number; SENT: number; BUNDLED: number; FAILED: number; ACKED: number; unsynced: number; lastAckAt: string | null } | undefined;
  urls: Urls | null;
  toasts: Toast[];
  toast: (msg: string, tone?: Tone) => void;
  dismiss: (id: number) => void;
  assetId: string | null;
  openAsset: (id: string | null) => void;
  sosOpen: boolean;
  setSosOpen: (v: boolean) => void;
  stationLabel: string;
}

const Ctx = createContext<FieldCtx | null>(null);

export function useField() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useField outside FieldProvider');
  return c;
}

export function FieldProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [storage, setStorage] = useState<Storage>({ state: 'booting' });
  const [sync, setSync] = useState<SyncInfo>({ link: 'offline', devKey: true, keyFp: null, lastError: null, lastPushAt: null });
  const [urls, setUrls] = useState<Urls | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [assetId, openAsset] = useState<string | null>(null);
  const [sosOpen, setSosOpen] = useState(false);
  const [secure, setSecure] = useState(true);
  const toastSeq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((msg: string, tone: Tone = 'info') => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-3), { id, msg, tone }]);
    // Alerts stay until dismissed; routine confirmations clear themselves.
    if (tone !== 'alert') setTimeout(() => dismiss(id), 3200);
  }, [dismiss]);

  // Boot: prefs + session from storage, runtime URLs, worker events.
  useEffect(() => {
    setPrefsState({ ...DEFAULT_PREFS, ...(load<Prefs>(PREFS) ?? {}) });
    setSecure(window.isSecureContext);
    const s = currentSession();
    if (s && (!s.exp || s.exp > Date.now() || s.offlineUnlock)) setSession(s);
    void resolveUrls().then(setUrls);
    return onWorker((e) => {
      if (e.type === 'ready') setStorage(e.storage === 'opfs' ? { state: 'opfs' } : { state: 'memory', reason: e.reason });
      else if (e.type === 'fatal') setStorage({ state: 'fatal', reason: e.error });
      else if (e.type === 'sync') setSync(e.info);
      else if (e.type === 'push' && e.entity === 'emergencies' && (e.patch as { status?: string }).status === 'ACTIVE') {
        haptic([200, 100, 200, 100, 400]);
        toast(`SOS received from another unit — open Muster`, 'alert');
      }
    });
  }, [toast]);

  // Prefs → <html> attributes (an inline script in layout applies them before first paint).
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = prefs.theme;
    el.classList.toggle('glove', prefs.glove);
    el.classList.toggle('bigtext', prefs.bigText);
  }, [prefs]);

  const actorId = session ? session.deviceId : '';

  // One sync engine per session, owned by the worker — nothing here to leak on remount.
  useEffect(() => {
    setToken(session?.token ?? null);
    if (!session || !urls) { setWorkerSession(null); return; }
    setWorkerSession({ ctx: { stationId: session.stationId, deviceId: session.deviceId, actorId, drill: prefs.drill }, gatewayUrl: urls.gatewayUrl });
  }, [session, urls, actorId, prefs.drill]);

  const outbox = useLiveQuery(() => db.outboxBreakdown(), ['outbox'], [session?.stationId]).data;

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      store(PREFS, next);
      return next;
    });
  }, []);

  const login = useCallback(async (o: { stationId: string; pin: string; role: Role; deviceId: string }) => {
    const s = await doLogin(o);
    setSession(s);
    return s;
  }, []);

  const logout = useCallback((forget = false) => {
    doLogout(forget);
    setSession(null);
  }, []);

  const value = useMemo<FieldCtx>(() => ({
    session, actorId, login, logout, prefs, setPrefs, storage, secure, sync, outbox, urls, toasts, toast, dismiss,
    assetId, openAsset, sosOpen, setSosOpen, stationLabel: session ? stationName(session.stationId) : '',
  }), [session, actorId, login, logout, prefs, setPrefs, storage, secure, sync, outbox, urls, toasts, toast, dismiss, assetId, sosOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
