'use client';
import { useEffect, useState } from 'react';
import { useDashboard, STATIONS } from '../../../lib/context';
import { api, ApiError } from '../../../lib/api';
import { Table, TableHead, TableRow, TableHeadCell, TableBody, TableCell, TableEmpty } from '../../../components/ui/table';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../../components/ui/dialog';

type Expedition = { id: string; name: string; program: 'ARCTIC' | 'ANTARCTIC' | string; status: string; season: string };
type Leg = { id: string; seq: number; from_point: string; to_point: string; mode: string; vessel_imo: string | null; eta_depart: string | null; eta_arrive: string | null; status: string };
type Manifest = { id: string; destination_station: string; sku: string | null; description: string; qty: number; unit: string; temp_zone: string; customs_status: string; biosecurity_status: string; stage: string; labelling_code: string };
type StationReadiness = { staged: number; manifest_total: number; staged_pct: number; fuel_days?: number; two_month_warning?: boolean };
type Readiness = { expedition_id: string; stations: Record<string, StationReadiness>; cost_inr?: { total_inr: number } };
type MutualAid = { sku: string; from_station: string; surplus: number; to_station: string; need: number; transfer_qty: number; via_leg?: { from_point: string; to_point: string } };

const EXPEDITION_STATUS = ['PLANNED', 'STUFFING', 'IN_TRANSIT', 'DELIVERED', 'WINTER_OVER', 'COMPLETE'];
const MANIFEST_STAGES = ['GOA', 'MUMBAI', 'CAPETOWN', 'VESSEL', 'STATION', 'CRATE'];
const LEG_MODES = ['SEA', 'AIR', 'TRAVERSE'];

export default function ExpeditionsPage() {
  const { pushToast } = useDashboard();
  const [expeditions, setExpeditions] = useState<Expedition[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [mutualAid, setMutualAid] = useState<MutualAid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [legOpen, setLegOpen] = useState(false);
  const [manOpen, setManOpen] = useState(false);
  const [newExp, setNewExp] = useState({ name: '', program: 'ANTARCTIC', season: '' });
  const [newLeg, setNewLeg] = useState({ seq: 1, from_point: 'GOA', to_point: 'MAITRI', mode: 'SEA' });
  const [newMan, setNewMan] = useState({ destination_station: 'ST-BHARATI', sku: '', description: '', qty: 1, unit: 'pcs', temp_zone: 'AMBIENT' });

  function loadExpeditions() {
    setLoading(true);
    setError(null);
    Promise.all([api.get<Expedition[]>('/expeditions'), api.get<MutualAid[]>('/procurement/mutual-aid')])
      .then(([exps, aid]) => {
        setExpeditions(exps || []);
        setMutualAid(aid || []);
        setSelected((cur) => cur && (exps || []).some((e) => e.id === cur) ? cur : (exps && exps[0] ? exps[0].id : null));
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(loadExpeditions, []);

  function loadDetail(id: string) {
    api.get<Leg[]>(`/expeditions/${id}/legs`).then(setLegs).catch(() => setLegs([]));
    api.get<Manifest[]>(`/expeditions/${id}/manifests`).then(setManifests).catch(() => setManifests([]));
    api.get<Readiness>(`/expeditions/${id}/readiness`).then(setReadiness).catch(() => setReadiness(null));
  }

  useEffect(() => {
    if (selected) loadDetail(selected);
    else { setLegs([]); setManifests([]); setReadiness(null); }
  }, [selected]);

  async function createExpedition() {
    if (!newExp.name.trim()) return pushToast('Name required');
    try {
      const r = await api.post<{ id: string }>('/expeditions', { ...newExp, season: newExp.season || '46-ISEA-2026', created_by: 'HQ_COMMAND' });
      pushToast(`Expedition created: ${r.id}`);
      setNewOpen(false);
      setNewExp({ name: '', program: 'ANTARCTIC', season: '' });
      loadExpeditions();
      setSelected(r.id);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.message : 'Error creating expedition');
    }
  }

  async function advanceExpedition(id: string, status: string) {
    try {
      await api.patch(`/expeditions/${id}`, { status });
      pushToast(`Expedition → ${status}`);
      loadExpeditions();
    } catch (e) {
      pushToast(e instanceof ApiError ? e.message : 'Error advancing expedition');
    }
  }

  async function addLeg() {
    if (!selected) return;
    try {
      await api.post(`/expeditions/${selected}/legs`, newLeg);
      pushToast('Leg added');
      setLegOpen(false);
      loadDetail(selected);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.message : 'Error adding leg');
    }
  }

  async function addManifest() {
    if (!selected) return;
    if (!newMan.description.trim()) return pushToast('Description required');
    try {
      await api.post(`/expeditions/${selected}/manifests`, newMan);
      pushToast('Manifest added');
      setManOpen(false);
      setNewMan({ destination_station: 'ST-BHARATI', sku: '', description: '', qty: 1, unit: 'pcs', temp_zone: 'AMBIENT' });
      loadDetail(selected);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.message : 'Error adding manifest');
    }
  }

  async function advanceManifest(mid: string, stage: string) {
    if (!selected) return;
    try {
      await api.patch(`/expeditions/${selected}/manifests/${mid}`, { stage });
      pushToast(`Manifest → ${stage}`);
      loadDetail(selected);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.message : 'Error advancing manifest — check customs/biosecurity/temp-zone gates');
    }
  }

  async function autoPack() {
    if (!selected) return;
    try {
      const r = await api.post<{ count: number; warnings: string[] }>(`/expeditions/${selected}/auto-pack`);
      pushToast(`Auto-pack: ${r.count} placed${r.warnings?.length ? `, ${r.warnings.length} warning(s)` : ''}`);
      loadDetail(selected);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.message : 'Error auto-packing');
    }
  }

  if (error) {
    return (
      <div className="border border-flare/40 bg-flare/5 p-4 text-xs text-flare">
        Couldn't load expedition data: {error}. Check the HQ API is reachable.
      </div>
    );
  }

  const current = expeditions.find((e) => e.id === selected);
  const nextExpStatus = current ? EXPEDITION_STATUS[EXPEDITION_STATUS.indexOf(current.status) + 1] : null;

  return (
    <div className="space-y-4">
      {/* Expedition list */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="display text-lg text-ink">Expedition Planner — ISEA Antarctic + Himadri Arctic</h2>
            <p className="eyebrow mt-0.5">{expeditions.length} EXPEDITIONS · CUSTODY GOA→MUMBAI→CAPETOWN→VESSEL→STATION→CRATE</p>
          </div>
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild>
              <button className="px-3.5 py-1.5 border border-structure bg-cobalt text-white text-xs font-bold hover:bg-structure">+ New expedition</button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>New expedition</DialogTitle>
              <div className="space-y-3 mt-4">
                <div>
                  <label className="text-xs font-semibold text-slate block mb-1">Name</label>
                  <input value={newExp.name} onChange={(e) => setNewExp({ ...newExp, name: e.target.value })} className="w-full bg-canvas border border-structure px-3 h-10 text-sm text-ink focus:outline-none focus:border-cobalt" placeholder="47th Indian Scientific Expedition" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-slate block mb-1">Program</label>
                    <select value={newExp.program} onChange={(e) => setNewExp({ ...newExp, program: e.target.value })} className="w-full bg-canvas border border-structure px-3 h-10 text-xs font-bold text-ink focus:outline-none focus:border-cobalt">
                      <option value="ANTARCTIC">ANTARCTIC</option>
                      <option value="ARCTIC">ARCTIC</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate block mb-1">Season</label>
                    <input value={newExp.season} onChange={(e) => setNewExp({ ...newExp, season: e.target.value })} className="w-full bg-canvas border border-structure px-3 h-10 text-sm font-mono text-ink focus:outline-none focus:border-cobalt" placeholder="47-ISEA-2027" />
                  </div>
                </div>
                <button onClick={createExpedition} className="w-full h-10 border border-structure bg-cobalt text-white font-bold text-xs hover:bg-structure">Create</button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {expeditions.map((e) => (
            <button key={e.id} onClick={() => setSelected(e.id)} className={`card p-4 space-y-1.5 text-left transition ${selected === e.id ? 'border-cobalt ring-1 ring-cobalt' : ''}`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 font-bold border ${e.program === 'ARCTIC' ? 'bg-phosphor/10 text-cyan-700 border-phosphor/30' : 'bg-cobalt/10 text-cobalt border-cobalt/30'}`}>{e.program}</span>
                <span className="text-[10px] px-2 py-0.5 font-mono font-bold border border-structure/30 bg-canvas text-slate">{e.status}</span>
              </div>
              <div className="font-bold text-sm text-ink">{e.name}</div>
              <div className="text-[11px] text-slate font-mono">{e.season} · {e.id}</div>
            </button>
          ))}
          {!loading && expeditions.length === 0 && <div className="text-xs text-slate">No expeditions yet.</div>}
        </div>
      </div>

      {current && (
        <>
          {/* Status + readiness */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold text-base text-ink">{current.name} — {current.status}</h3>
              {nextExpStatus && (
                <button onClick={() => advanceExpedition(current.id, nextExpStatus)} className="px-3 py-1 border border-structure bg-ink text-white text-xs font-bold hover:bg-structure">
                  Advance → {nextExpStatus}
                </button>
              )}
            </div>
            {readiness && (
              <div className="grid md:grid-cols-3 gap-3">
                {Object.entries(readiness.stations || {}).map(([sid, r]) => (
                  <div key={sid} className="card p-4 space-y-1">
                    <div className="font-bold text-sm text-ink">{sid}</div>
                    <div className="text-xs text-slate font-mono">{r.staged}/{r.manifest_total} staged ({r.staged_pct}%)</div>
                    <div className="text-xs text-slate font-mono">
                      Fuel: {r.fuel_days ?? '—'} days{' '}
                      {r.two_month_warning && <span className="text-flare font-bold">⚠ 60-day watch</span>}
                    </div>
                  </div>
                ))}
                {readiness.cost_inr && <div className="card p-4 space-y-1"><div className="font-bold text-sm text-ink">Freight cost</div><div className="text-xs text-slate font-mono">₹{readiness.cost_inr.total_inr.toLocaleString('en-IN')}</div></div>}
              </div>
            )}
          </div>

          {/* Legs */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-ink">Voyage legs</h3>
              <Dialog open={legOpen} onOpenChange={setLegOpen}>
                <DialogTrigger asChild>
                  <button className="px-3 py-1 border border-structure bg-canvas text-ink text-xs font-bold hover:bg-structure hover:text-canvas">+ Add leg</button>
                </DialogTrigger>
                <DialogContent>
                  <DialogTitle>Add voyage leg</DialogTitle>
                  <div className="space-y-3 mt-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-semibold text-slate block mb-1">Seq</label>
                        <input type="number" value={newLeg.seq} onChange={(e) => setNewLeg({ ...newLeg, seq: Number(e.target.value) || 1 })} className="w-full bg-canvas border border-structure px-3 h-10 text-sm text-ink focus:outline-none focus:border-cobalt" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate block mb-1">Mode</label>
                        <select value={newLeg.mode} onChange={(e) => setNewLeg({ ...newLeg, mode: e.target.value })} className="w-full bg-canvas border border-structure px-3 h-10 text-xs font-bold text-ink focus:outline-none focus:border-cobalt">
                          {LEG_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-semibold text-slate block mb-1">From</label>
                        <input value={newLeg.from_point} onChange={(e) => setNewLeg({ ...newLeg, from_point: e.target.value })} className="w-full bg-canvas border border-structure px-3 h-10 text-sm font-mono text-ink focus:outline-none focus:border-cobalt" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate block mb-1">To</label>
                        <input value={newLeg.to_point} onChange={(e) => setNewLeg({ ...newLeg, to_point: e.target.value })} className="w-full bg-canvas border border-structure px-3 h-10 text-sm font-mono text-ink focus:outline-none focus:border-cobalt" />
                      </div>
                    </div>
                    <button onClick={addLeg} className="w-full h-10 border border-structure bg-cobalt text-white font-bold text-xs hover:bg-structure">Add leg</button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeadCell>Seq</TableHeadCell>
                  <TableHeadCell>Route</TableHeadCell>
                  <TableHeadCell>Mode</TableHeadCell>
                  <TableHeadCell>Vessel</TableHeadCell>
                  <TableHeadCell>Status</TableHeadCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {legs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono">{l.seq}</TableCell>
                    <TableCell className="font-mono font-bold">{l.from_point} → {l.to_point}</TableCell>
                    <TableCell>{l.mode}</TableCell>
                    <TableCell className="font-mono">{l.vessel_imo || '—'}</TableCell>
                    <TableCell><span className="px-2 py-0.5 font-bold font-mono text-[11px] border border-structure bg-canvas text-ink">{l.status}</span></TableCell>
                  </TableRow>
                ))}
                {legs.length === 0 && <TableEmpty colSpan={5}>No legs planned yet.</TableEmpty>}
              </TableBody>
            </Table>
          </div>

          {/* Manifests */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold text-base text-ink">Cargo manifests</h3>
              <div className="flex gap-2">
                <button onClick={autoPack} className="px-3 py-1 border border-structure bg-canvas text-ink text-xs font-bold hover:bg-structure hover:text-canvas">Auto-pack</button>
                <Dialog open={manOpen} onOpenChange={setManOpen}>
                  <DialogTrigger asChild>
                    <button className="px-3 py-1 border border-structure bg-cobalt text-white text-xs font-bold hover:bg-structure">+ Add manifest</button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogTitle>Add cargo manifest</DialogTitle>
                    <div className="space-y-3 mt-4">
                      <div>
                        <label className="text-xs font-semibold text-slate block mb-1">Description</label>
                        <input value={newMan.description} onChange={(e) => setNewMan({ ...newMan, description: e.target.value })} className="w-full bg-canvas border border-structure px-3 h-10 text-sm text-ink focus:outline-none focus:border-cobalt" placeholder="Diesel winter grade" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-semibold text-slate block mb-1">Destination</label>
                          <select value={newMan.destination_station} onChange={(e) => setNewMan({ ...newMan, destination_station: e.target.value })} className="w-full bg-canvas border border-structure px-3 h-10 text-xs font-bold text-ink focus:outline-none focus:border-cobalt">
                            {STATIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate block mb-1">Temp zone</label>
                          <select value={newMan.temp_zone} onChange={(e) => setNewMan({ ...newMan, temp_zone: e.target.value })} className="w-full bg-canvas border border-structure px-3 h-10 text-xs font-bold text-ink focus:outline-none focus:border-cobalt">
                            <option value="AMBIENT">AMBIENT</option>
                            <option value="COLD">COLD</option>
                            <option value="HAZMAT">HAZMAT</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-semibold text-slate block mb-1">Qty</label>
                          <input type="number" value={newMan.qty} onChange={(e) => setNewMan({ ...newMan, qty: Number(e.target.value) || 1 })} className="w-full bg-canvas border border-structure px-3 h-10 text-sm text-ink focus:outline-none focus:border-cobalt" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate block mb-1">Unit</label>
                          <input value={newMan.unit} onChange={(e) => setNewMan({ ...newMan, unit: e.target.value })} className="w-full bg-canvas border border-structure px-3 h-10 text-sm font-mono text-ink focus:outline-none focus:border-cobalt" />
                        </div>
                      </div>
                      <button onClick={addManifest} className="w-full h-10 border border-structure bg-cobalt text-white font-bold text-xs hover:bg-structure">Add manifest</button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeadCell>Label</TableHeadCell>
                  <TableHeadCell>Destination</TableHeadCell>
                  <TableHeadCell>Description</TableHeadCell>
                  <TableHeadCell className="text-center">Qty</TableHeadCell>
                  <TableHeadCell>Stage</TableHeadCell>
                  <TableHeadCell className="text-right">Action</TableHeadCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {manifests.map((m) => {
                  const next = MANIFEST_STAGES[MANIFEST_STAGES.indexOf(m.stage) + 1];
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-[11px]">{m.labelling_code}</TableCell>
                      <TableCell>{m.destination_station}</TableCell>
                      <TableCell>{m.description}{m.sku ? <div className="text-[10px] text-slate font-mono">{m.sku}</div> : null}</TableCell>
                      <TableCell className="text-center font-bold text-sm">{m.qty} {m.unit}</TableCell>
                      <TableCell><span className="px-2.5 py-0.5 font-bold font-mono text-[11px] border border-structure bg-canvas text-ink">{m.stage}</span></TableCell>
                      <TableCell className="text-right">
                        {next && (
                          <button onClick={() => advanceManifest(m.id, next)} className="px-3 py-1 border border-structure bg-ink text-white text-xs font-bold hover:bg-structure">
                            → {next}
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {manifests.length === 0 && <TableEmpty colSpan={6}>No manifests yet.</TableEmpty>}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Mutual aid suggestions */}
      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-base text-ink">Mutual aid suggestions</h3>
        {mutualAid.length === 0 && <div className="text-xs text-slate">No inter-station transfers needed — all stations above target.</div>}
        {mutualAid.slice(0, 8).map((m, i) => (
          <div key={i} className="card p-3 text-xs text-slate font-mono">
            {m.sku}: {m.from_station} (surplus {m.surplus}) → {m.to_station} (need {m.need}) — transfer {m.transfer_qty}
            {m.via_leg ? ` via ${m.via_leg.from_point}→${m.via_leg.to_point}` : ' (no leg on record)'}
          </div>
        ))}
      </div>
    </div>
  );
}
