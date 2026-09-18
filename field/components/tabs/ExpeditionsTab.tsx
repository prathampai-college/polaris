'use client';
import { useState, useMemo } from 'react';

interface ExpeditionsTabProps {
  expeditions: any[];
  manifests: any[];
  currentStation: string;
  onCreateExpedition: (program: string, name: string, season: string) => void;
  onAdvanceManifest: (manifestId: string, stage: string) => void;
  onRefreshExpeditions: () => void;
  glove?: boolean;
}

const STAGES = ['GOA', 'MUMBAI', 'CAPETOWN', 'VESSEL', 'STATION', 'CRATE'];

export function ExpeditionsTab({
  expeditions, manifests, currentStation,
  onCreateExpedition, onAdvanceManifest, onRefreshExpeditions, glove,
}: ExpeditionsTabProps) {
  const [program, setProgram] = useState('ANTARCTIC');
  const [name, setName] = useState('');
  const [season, setSeason] = useState('46-ISEA-2026');
  const [selected, setSelected] = useState<string | null>(null);

  const stationManifests = useMemo(() => {
    if (!selected) return [];
    return manifests.filter((m: any) => m.expedition_id === selected && (!m.destination_station || m.destination_station === currentStation));
  }, [manifests, selected, currentStation]);

  const stagedPct = useMemo(() => {
    if (!selected) return 0;
    const all = manifests.filter((m: any) => m.expedition_id === selected);
    if (!all.length) return 100;
    const done = all.filter((m: any) => m.stage === 'STATION' || m.stage === 'CRATE').length;
    return Math.round((100 * done) / all.length);
  }, [manifests, selected]);

  function nextStage(s: string) {
    const i = STAGES.indexOf(s);
    return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center justify-between gap-3 bg-gradient-to-r from-teal-950/40 via-[#0d1526] to-black/40 border-teal-500/30">
        <div>
          <div className="text-[11px] font-mono tracking-widest text-teal-400 font-bold uppercase">Expedition Planning</div>
          <div className="text-sm font-bold text-white mt-0.5">ISEA Antarctic + Himadri Arctic programs</div>
          <div className="text-xs text-white/50 mt-0.5">Offline-first manifests with AL-1403-style custody stages</div>
        </div>
        <button
          onClick={onRefreshExpeditions}
          className={`px-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition ${glove ? 'py-3' : 'py-2'}`}
        >
          Sync from HQ
        </button>
      </div>

      <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-4">
        <div className="card p-4 space-y-3">
          <h3 className="font-bold text-white text-base">Expeditions</h3>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {expeditions.map((e: any) => (
              <button
                key={e.id}
                onClick={() => setSelected(e.id)}
                className={`w-full text-left bg-black/40 border rounded-xl p-3 transition ${selected === e.id ? 'border-teal-400' : 'border-white/10 hover:border-teal-400/40'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${e.program === 'ARCTIC' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-teal-500/15 text-teal-300'}`}>{e.program}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/70 font-mono">{e.status}</span>
                </div>
                <div className="text-sm font-bold text-white mt-1">{e.name}</div>
                <div className="text-[11px] text-white/50 font-mono">{e.season} • {e.id}</div>
              </button>
            ))}
            {expeditions.length === 0 && <div className="text-center py-8 text-xs text-white/40">No expeditions yet — pull from HQ or create one below.</div>}
          </div>
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select value={program} onChange={(ev) => setProgram(ev.target.value)} className="bg-black/40 border border-white/15 rounded-xl px-3 h-10 text-xs">
                <option value="ANTARCTIC">ANTARCTIC (ISEA)</option>
                <option value="ARCTIC">ARCTIC (Himadri)</option>
              </select>
              <input value={season} onChange={(ev) => setSeason(ev.target.value)} placeholder="Season" className="bg-black/40 border border-white/15 rounded-xl px-3 h-10 text-xs" />
            </div>
            <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="e.g. 47th Indian Scientific Expedition" className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-10 text-xs" />
            <button
              onClick={() => { if (name.trim()) { onCreateExpedition(program, name.trim(), season.trim() || '46-ISEA-2026'); setName(''); } }}
              className="w-full h-10 rounded-xl bg-teal-500 hover:bg-teal-400 text-white font-bold text-xs"
            >
              + Create expedition offline
            </button>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-base">Manifest custody — {currentStation}</h3>
              <p className="text-xs text-white/50">{selected ? `${stagedPct}% staged at station/crate` : 'Select an expedition to track custody'}</p>
            </div>
          </div>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {stationManifests.map((m: any) => {
              const nx = nextStage(m.stage);
              return (
                <div key={m.id} className="bg-black/40 border border-white/10 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-white">{m.description || m.labelling_code}</div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/70 font-mono font-bold">{m.stage}</span>
                  </div>
                  <div className="text-[11px] text-white/50 font-mono">{m.labelling_code} • {m.qty} {m.unit} • {m.temp_zone}</div>
                  {nx && (
                    <button onClick={() => onAdvanceManifest(m.id, nx)} className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold">
                      Advance → {nx}
                    </button>
                  )}
                </div>
              );
            })}
            {selected && stationManifests.length === 0 && <div className="text-center py-8 text-xs text-white/40">No manifests bound for {currentStation} in this expedition.</div>}
            {!selected && <div className="text-center py-8 text-xs text-white/40">Select an expedition on the left.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
