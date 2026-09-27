'use client';
import { useEffect, useState } from 'react';
import { useDashboard, STATIONS } from '../../../lib/context';
import { api, ApiError } from '../../../lib/api';
import { Table, TableHead, TableRow, TableHeadCell, TableBody, TableCell, TableEmpty } from '../../../components/ui/table';
import { Dialog, DialogContent, DialogTitle, DialogTrigger, DialogClose } from '../../../components/ui/dialog';

type Indent = {
  id: string;
  station_id?: string;
  asset_id: string;
  sku?: string;
  qty_requested: number;
  urgency: string;
  status: string;
  created_by?: string;
};
type Asset = { id: string; sku: string; name: string; qty: number; unit: string };

const FILTERS = ['ALL', 'DRAFT', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'CRITICAL'];

export default function IndentsPage() {
  const { selectedStation, pushToast } = useDashboard();
  const [indents, setIndents] = useState<Indent[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [newAsset, setNewAsset] = useState('');
  const [newQty, setNewQty] = useState(10);
  const [newUrg, setNewUrg] = useState('CRITICAL');

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([api.get<Indent[]>(`/indents?station_id=${selectedStation}`), api.get<Asset[]>('/assets')])
      .then(([ind, a]) => {
        setIndents(ind || []);
        setAssets(a || []);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [selectedStation]);

  async function updateIndent(id: string, status: string) {
    try {
      const body: Record<string, unknown> = { status, actor_id: 'NCPOR_ADMIN' };
      if (status === 'DISPATCHED') {
        const vlist = await api.get<any[]>(`/vessels?station_id=${selectedStation}`).catch(() => []);
        if (Array.isArray(vlist) && vlist.length) body.vessel_imo = vlist[0].imo;
      }
      const j = await api.patch<{ id: string }>(`/indents/${id}`, body);
      pushToast(`Indent updated: ${status} (${j.id?.slice(0, 8)})`);
      load();
    } catch (e) {
      pushToast(e instanceof ApiError ? e.message : 'Error updating indent');
    }
  }

  async function createIndent() {
    if (!newAsset) return pushToast('Select asset');
    try {
      await api.post('/indents', {
        station_id: selectedStation,
        asset_id: newAsset,
        qty_requested: Number(newQty) || 10,
        urgency: newUrg,
        created_by: 'HQ_COMMAND',
        status: 'APPROVED',
      });
      pushToast('Emergency Resupply Indent Created & Approved');
      setOpen(false);
      setNewAsset('');
      load();
    } catch (e) {
      pushToast(e instanceof ApiError ? e.message : 'Error creating indent');
    }
  }

  const filtered = indents.filter((ind) => {
    if (filter === 'ALL') return true;
    if (filter === 'CRITICAL') return ind.urgency === 'CRITICAL';
    return ind.status === filter;
  });

  if (error) {
    return (
      <div className="border border-flare/40 bg-flare/5 p-4 text-xs text-flare">
        Couldn't load indents: {error}. Check the HQ API is reachable.
      </div>
    );
  }

  const stationName = STATIONS.find((s) => s.id === selectedStation)?.name || selectedStation;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="display font-bold text-base text-ink">Indent Operations Workbench</h2>
          <p className="text-xs text-slate">Real-time state machine: DRAFT → APPROVED → DISPATCHED → RECEIVED</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1 overflow-x-auto scroll-thin">
            {FILTERS.map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-3 py-1 font-mono text-xs font-bold border transition ${
                  filter === k ? 'bg-cobalt text-white border-cobalt' : 'bg-canvas text-slate border-structure hover:bg-structure hover:text-canvas'
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <button className="px-3.5 py-1.5 border border-structure bg-cobalt text-white text-xs font-bold hover:bg-structure">
                + New HQ Indent
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Issue Emergency Resupply Indent</DialogTitle>
              <p className="text-xs text-slate mt-1">Dispatch directly from NCPOR Central Logistics</p>

              <div className="space-y-3 mt-4">
                <div>
                  <label className="text-xs font-semibold text-slate block mb-1">Target Station</label>
                  <div className="p-2.5 border border-structure bg-canvas font-bold text-xs text-ink">{stationName}</div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate block mb-1">Supply SKU</label>
                  <select
                    value={newAsset}
                    onChange={(e) => setNewAsset(e.target.value)}
                    className="w-full bg-canvas border border-structure px-3 h-10 text-xs font-mono text-ink focus:outline-none focus:border-cobalt"
                  >
                    <option value="">Select supply SKU…</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.sku} — {a.name} ({a.qty} {a.unit} current)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-slate block mb-1">Dispatch Quantity</label>
                    <input
                      type="number"
                      value={newQty}
                      onChange={(e) => setNewQty(Number(e.target.value) || 1)}
                      className="w-full bg-canvas border border-structure px-3 h-10 text-sm font-bold text-ink focus:outline-none focus:border-cobalt"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate block mb-1">Priority</label>
                    <select
                      value={newUrg}
                      onChange={(e) => setNewUrg(e.target.value)}
                      className="w-full bg-canvas border border-structure px-3 h-10 text-xs font-bold text-ink focus:outline-none focus:border-cobalt"
                    >
                      <option value="CRITICAL">CRITICAL</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="LOW">LOW</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={createIndent}
                  className="w-full h-10 border border-structure bg-cobalt text-white font-bold text-xs hover:bg-structure"
                >
                  Approve & Dispatch Indent
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Table>
        <TableHead>
          <TableRow>
            <TableHeadCell>Indent ID</TableHeadCell>
            <TableHeadCell>Station</TableHeadCell>
            <TableHeadCell>Supply SKU</TableHeadCell>
            <TableHeadCell className="text-center">Qty</TableHeadCell>
            <TableHeadCell className="text-center">Urgency</TableHeadCell>
            <TableHeadCell className="text-center">Status</TableHeadCell>
            <TableHeadCell className="text-right">Action</TableHeadCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filtered.map((ind) => (
            <TableRow key={ind.id}>
              <TableCell className="font-mono font-bold">{ind.id.slice(0, 8)}</TableCell>
              <TableCell>{ind.station_id || selectedStation}</TableCell>
              <TableCell>
                <div className="font-mono font-bold text-ink">{ind.sku || ind.asset_id}</div>
                <div className="text-[10px] text-slate">Created by {ind.created_by}</div>
              </TableCell>
              <TableCell className="text-center font-bold text-sm">{ind.qty_requested}</TableCell>
              <TableCell className="text-center">
                <span className={`px-2 py-0.5 font-bold text-[11px] border ${ind.urgency === 'CRITICAL' ? 'border-flare/40 bg-flare/10 text-flare' : 'border-structure/30 text-slate'}`}>
                  {ind.urgency}
                </span>
              </TableCell>
              <TableCell className="text-center">
                <span className="px-2.5 py-0.5 font-bold font-mono text-[11px] border border-structure bg-canvas text-ink">{ind.status}</span>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex gap-1.5 justify-end">
                  {ind.status === 'DRAFT' && (
                    <button onClick={() => updateIndent(ind.id, 'APPROVED')} className="px-3 py-1 border border-structure bg-cobalt text-white text-xs font-bold hover:bg-structure">
                      Approve →
                    </button>
                  )}
                  {ind.status === 'APPROVED' && (
                    <button onClick={() => updateIndent(ind.id, 'DISPATCHED')} className="px-3 py-1 border border-structure bg-ink text-white text-xs font-bold hover:bg-structure">
                      Dispatch
                    </button>
                  )}
                  {ind.status === 'DISPATCHED' && (
                    <button onClick={() => updateIndent(ind.id, 'RECEIVED')} className="px-3 py-1 border border-structure bg-canvas text-cobalt text-xs font-bold hover:bg-structure hover:text-canvas">
                      Mark Received
                    </button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!loading && filtered.length === 0 && <TableEmpty colSpan={7}>No indents match this filter.</TableEmpty>}
        </TableBody>
      </Table>
    </div>
  );
}
