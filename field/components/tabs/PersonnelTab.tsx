'use client';
import { useState, useMemo } from 'react';

interface PersonnelTabProps {
  personnel: any[];
  sorties: any[];
  emergencies: any[];
  currentStation: string;
  onUpdatePersonnelStatus: (id: string, status: string) => void;
  onCreateSortie: (leadId: string, destination: string, expectedReturn: string, buddyId?: string, soloOverride?: boolean) => void;
  onUpdateSortieStatus: (sortieId: string, status: string) => void;
  onTriggerSOS: (type: string, locationCoord?: string) => void;
  onResolveEmergency: (emergencyId: string) => void;
  glove?: boolean;
}

export function PersonnelTab({
  personnel,
  sorties,
  emergencies,
  currentStation,
  onUpdatePersonnelStatus,
  onCreateSortie,
  onUpdateSortieStatus,
  onTriggerSOS,
  onResolveEmergency,
  glove
}: PersonnelTabProps) {
  const [showSosModal, setShowSosModal] = useState(false);
  const [sosType, setSosType] = useState('SOS_MEDICAL');
  const [sosLocation, setSosLocation] = useState('Sector 4 - Blue Ice Moraine');

  const [showSortieModal, setShowSortieModal] = useState(false);
  const [sortieLead, setSortieLead] = useState('');
  const [sortieBuddy, setSortieBuddy] = useState('');
  const [sortieDest, setSortieDest] = useState('');
  const [sortieHours, setSortieHours] = useState('4');
  const [soloOverride, setSoloOverride] = useState(false);

  const stationPersonnel = useMemo(() => {
    return personnel.filter((p: any) => !p.station_id || p.station_id === currentStation);
  }, [personnel, currentStation]);

  const stationSorties = useMemo(() => {
    return sorties.filter((s: any) => !s.station_id || s.station_id === currentStation);
  }, [sorties, currentStation]);

  const activeEmergencies = useMemo(() => {
    return emergencies.filter((e: any) => (!e.station_id || e.station_id === currentStation) && e.status === 'ACTIVE');
  }, [emergencies, currentStation]);

  const musterStats = useMemo(() => {
    const total = stationPersonnel.length;
    const onStation = stationPersonnel.filter((p: any) => p.status === 'ON_STATION').length;
    const onSortie = stationPersonnel.filter((p: any) => p.status === 'FIELD_SORTIE').length;
    const evacuated = stationPersonnel.filter((p: any) => p.status === 'EVACUATED').length;
    return { total, onStation, onSortie, evacuated };
  }, [stationPersonnel]);

  function handleSosSubmit() {
    onTriggerSOS(sosType, sosLocation);
    setShowSosModal(false);
  }

  function handleSortieSubmit() {
    if (!sortieLead || !sortieDest) return;
    if (!sortieBuddy && !soloOverride) return;
    if (sortieBuddy && sortieBuddy === sortieLead) return;
    const expected = new Date(Date.now() + (Number(sortieHours) || 4) * 3600000).toISOString();
    onCreateSortie(sortieLead, sortieDest, expected, sortieBuddy || undefined, soloOverride);
    setShowSortieModal(false);
    setSortieDest('');
    setSortieBuddy('');
    setSoloOverride(false);
  }

  return (
    <div className="space-y-4">
      {/* Top Banner: Active Emergencies Alert */}
      {activeEmergencies.length > 0 && (
        <div className="card p-4 bg-red-950/80 border-2 border-red-500 rounded-2xl animate-pulse space-y-3 shadow-2xl shadow-red-900/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-3.5 h-3.5 rounded-full bg-red-400 animate-ping" />
              <h2 className="text-base font-black text-white tracking-wide">
                ⚠️ CRITICAL DISTRESS ACTIVE ({activeEmergencies.length}) — {currentStation}
              </h2>
            </div>
            <span className="text-xs px-2.5 py-1 rounded bg-red-500/30 text-red-200 border border-red-400 font-mono font-bold">
              OFFLINE MESH BROADCAST ACTIVE
            </span>
          </div>

          <div className="grid gap-2">
            {activeEmergencies.map((em: any) => (
              <div key={em.id} className="bg-black/60 border border-red-500/40 rounded-xl p-3 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-red-500 text-white font-black text-xs">
                      {em.type?.replace('SOS_', '')}
                    </span>
                    <span className="font-mono text-xs text-white/80">Reported by: {em.reported_by}</span>
                    <span className="text-[11px] text-white/50">{em.ts?.slice(11, 16) || 'Just now'}</span>
                  </div>
                  {em.location_coord && (
                    <div className="text-xs text-red-200 mt-1 font-mono">
                      📍 Location: <b>{em.location_coord}</b>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onResolveEmergency(em.id)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-md shadow-emerald-600/30"
                >
                  Mark Resolved ✓
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Bar: SOS Trigger + Muster Summary */}
      <div className="grid sm:grid-cols-[1.4fr_1fr] gap-3">
        {/* SOS Button Hero */}
        <div className="card card-glow p-4 flex items-center justify-between gap-4 bg-gradient-to-r from-red-950/40 via-[#130d22] to-black/40 border-red-500/30">
          <div>
            <div className="text-[11px] font-mono tracking-widest text-red-400 font-bold uppercase">
              Incident Command & Distress Mesh
            </div>
            <div className="text-sm font-bold text-white mt-0.5">
              1-Touch Emergency Beacon
            </div>
            <div className="text-xs text-white/50 mt-0.5">
              Air-gapped BLE broadcast & DTN mule queue
            </div>
          </div>
          <button
            onClick={() => setShowSosModal(true)}
            className={`px-5 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-black text-sm uppercase tracking-wider transition shadow-xl shadow-red-600/40 active:scale-95 flex items-center gap-2 border border-red-400 ${
              glove ? 'h-16 text-base' : 'h-12'
            }`}
          >
            <span>🚨</span>
            <span>SOS Distress</span>
          </button>
        </div>

        {/* Muster Roll Quick Stats */}
        <div className="card p-3 grid grid-cols-4 gap-1 text-center bg-black/40">
          <div className="p-2 rounded-xl bg-white/5">
            <div className="text-xl font-black text-white">{musterStats.total}</div>
            <div className="text-[10px] text-white/40 uppercase">Total</div>
          </div>
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-xl font-black text-emerald-400">{musterStats.onStation}</div>
            <div className="text-[10px] text-emerald-300 uppercase">Station</div>
          </div>
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
            <div className="text-xl font-black text-cyan-300">{musterStats.onSortie}</div>
            <div className="text-[10px] text-cyan-200 uppercase">Sortie</div>
          </div>
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div className="text-xl font-black text-amber-300">{musterStats.evacuated}</div>
            <div className="text-[10px] text-amber-200 uppercase">Evac</div>
          </div>
        </div>
      </div>

      {/* Main Grid: Station Muster Board & Field Sortie Checkout */}
      <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4">
        {/* Left Column: Station Muster Board */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-base">Station Muster Board</h3>
              <p className="text-xs text-white/50">Digital roll call for blizzard lock-in & station safety</p>
            </div>
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-teal-400/15 text-teal-300 border border-teal-400/25 font-mono">
              {currentStation}
            </span>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto scroll-thin pr-1">
            {stationPersonnel.map((p: any) => {
              const isOnStation = p.status === 'ON_STATION';
              const isOnSortie = p.status === 'FIELD_SORTIE';
              return (
                <div
                  key={p.id}
                  className="bg-black/40 border border-white/10 hover:border-teal-400/30 rounded-xl p-3 flex items-center justify-between transition gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white truncate">{p.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono font-bold">
                        {p.blood_group}
                      </span>
                    </div>
                    <div className="text-xs text-white/50 truncate mt-0.5">{p.role}</div>
                    <div className="text-[10px] text-white/40 font-mono mt-0.5">
                      Contact: {p.emergency_contact || 'Base UHF Ch 1'}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[10px] px-2.5 py-1 rounded-full font-bold border ${
                        isOnStation
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : isOnSortie
                          ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      {p.status?.replace('_', ' ')}
                    </span>
                    <button
                      onClick={() =>
                        onUpdatePersonnelStatus(p.id, isOnStation ? 'FIELD_SORTIE' : 'ON_STATION')
                      }
                      className={`px-3 rounded-lg text-xs font-bold transition ${
                        isOnStation
                          ? 'bg-white/10 hover:bg-cyan-600 text-white'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      } ${glove ? 'py-3' : 'py-1.5'}`}
                    >
                      {isOnStation ? 'Check Out' : 'Check In'}
                    </button>
                  </div>
                </div>
              );
            })}
            {stationPersonnel.length === 0 && (
              <div className="text-center py-10 text-xs text-white/40">No personnel registered for this station.</div>
            )}
          </div>
        </div>

        {/* Right Column: Field Sorties Tracker */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-base">Field Sorties & Traverse Board</h3>
              <p className="text-xs text-white/50">Track outdoor teams, skidoo runs & scientific excursions</p>
            </div>
            <button
              onClick={() => setShowSortieModal(true)}
              className={`px-3.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-white font-bold text-xs transition shadow-md shadow-teal-500/25 ${
                glove ? 'py-3' : 'py-1.5'
              }`}
            >
              + Log Sortie
            </button>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto scroll-thin pr-1">
            {stationSorties.map((s: any) => {
              const isActive = s.safety_status === 'ACTIVE';
              const isOverdue =
                isActive && s.expected_return_time && new Date(s.expected_return_time).getTime() < Date.now();
              return (
                <div
                  key={s.id}
                  className={`bg-black/40 border rounded-xl p-3 space-y-2 transition ${
                    isOverdue ? 'border-red-500 bg-red-950/20' : 'border-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span>{s.destination}</span>
                        {isOverdue && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-red-500 text-white font-bold animate-pulse">
                            ⚠️ OVERDUE
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-white/60 mt-0.5">
                        Lead: <b>{s.lead_name || s.lead_personnel_id}</b>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        s.safety_status === 'RETURNED'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : s.safety_status === 'EMERGENCY'
                          ? 'bg-red-500 text-white'
                          : 'bg-cyan-500/15 text-cyan-300'
                      }`}
                    >
                      {s.safety_status}
                    </span>
                  </div>

                  <div className="text-[11px] text-white/40 grid grid-cols-2 gap-1 font-mono pt-1 border-t border-white/5">
                    <div>Departed: {s.departure_time?.slice(11, 16) || '—'}</div>
                    <div>ETA Return: {s.expected_return_time?.slice(11, 16) || '—'}</div>
                  </div>

                  {isActive && (
                    <div className="pt-1 flex justify-end">
                      <button
                        onClick={() => onUpdateSortieStatus(s.id, 'RETURNED')}
                        className={`px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition ${
                          glove ? 'py-2.5' : 'py-1'
                        }`}
                      >
                        Safe Return ✓
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {stationSorties.length === 0 && (
              <div className="text-center py-10 text-xs text-white/40">No active or past sorties logged.</div>
            )}
          </div>
        </div>
      </div>

      {/* SOS Modal */}
      {showSosModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div onClick={() => setShowSosModal(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="relative w-full max-w-[440px] bg-[#140a18] border-2 border-red-500 rounded-3xl p-6 shadow-2xl space-y-4 text-white">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-black text-lg text-red-400">Broadcast SOS Distress Beacon</h3>
                <p className="text-xs text-white/60">Instant peer alert + high-priority queue to HQ</p>
              </div>
              <button
                onClick={() => setShowSosModal(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-white/80 block mb-1">Distress Emergency Type</label>
                <select
                  value={sosType}
                  onChange={(e) => setSosType(e.target.value)}
                  className="w-full bg-black/60 border border-red-500/40 rounded-xl px-3 h-11 text-xs font-bold focus:outline-none focus:border-red-400"
                >
                  <option value="SOS_MEDICAL">🚑 MEDICAL EMERGENCY (Hypothermia / Injury)</option>
                  <option value="SOS_FIRE">🔥 FIRE OUTBREAK (Station / Generator Module)</option>
                  <option value="SOS_WHITEOUT">❄️ WHITEOUT / CREVASSE HAZARD (Lost in storm)</option>
                  <option value="SOS_POWER">⚡ COMPLETE GENERATOR FAILURE (Sub-zero freeze threat)</option>
                  <option value="SOS_VEHICLE">🚜 PISTENBULLY / SNOWCAT BREAKDOWN (Stranded)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-white/80 block mb-1">Location / Grid Reference</label>
                <input
                  type="text"
                  value={sosLocation}
                  onChange={(e) => setSosLocation(e.target.value)}
                  placeholder="e.g. Larsemann Hills Waypoint 12"
                  className="w-full bg-black/60 border border-white/20 rounded-xl px-3 h-11 text-xs font-mono"
                />
              </div>

              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[11px] text-red-200">
                🚨 This will sound an immediate alarm across all linked polar tablets and trigger automatic MEDEVAC protocols at NCPOR Command.
              </div>

              <button
                onClick={handleSosSubmit}
                className="w-full h-12 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-sm uppercase tracking-wider shadow-lg shadow-red-600/40 transition active:scale-95"
              >
                Transmit Distress Beacon Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sortie Modal */}
      {showSortieModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div onClick={() => setShowSortieModal(false)} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-[440px] bg-[#0E1830] border border-teal-400/30 rounded-3xl p-6 shadow-2xl space-y-4 text-white">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-base text-white">Log Field Sortie Checkout</h3>
                <p className="text-xs text-white/50">Mandatory polar safety check-out before leaving base</p>
              </div>
              <button
                onClick={() => setShowSortieModal(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1">Lead Expeditioner</label>
                <select
                  value={sortieLead}
                  onChange={(e) => setSortieLead(e.target.value)}
                  className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-xs focus:outline-none focus:border-teal-400"
                >
                  <option value="">Select team leader…</option>
                  {stationPersonnel.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1">Destination & Purpose</label>
                <input
                  type="text"
                  value={sortieDest}
                  onChange={(e) => setSortieDest(e.target.value)}
                  placeholder="e.g. Lake Priyadarshini water sampling"
                  className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1">Buddy (mandatory pair)</label>
                <select
                  value={sortieBuddy}
                  onChange={(e) => setSortieBuddy(e.target.value)}
                  className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-xs focus:outline-none focus:border-teal-400"
                >
                  <option value="">Select buddy…</option>
                  {stationPersonnel.filter((p: any) => p.id !== sortieLead && p.status === 'ON_STATION').map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.role})
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 mt-2 text-xs text-white/70">
                  <input type="checkbox" checked={soloOverride} onChange={(e) => setSoloOverride(e.target.checked)} />
                  Solo override — requires STATION_LEAD (audited)
                </label>
                {sortieBuddy && sortieBuddy === sortieLead && <div className="text-xs text-red-400 mt-1">Buddy must differ from lead</div>}
              </div>

              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1">Expected Return Window</label>
                <select
                  value={sortieHours}
                  onChange={(e) => setSortieHours(e.target.value)}
                  className="w-full bg-black/40 border border-white/15 rounded-xl px-3 h-11 text-xs focus:outline-none focus:border-teal-400"
                >
                  <option value="2">2 Hours (Local perimeter inspection)</option>
                  <option value="4">4 Hours (Standard field sortie)</option>
                  <option value="8">8 Hours (Day traverse / Moraine)</option>
                  <option value="24">24 Hours (Overnight field camp)</option>
                </select>
              </div>

              <button
                onClick={handleSortieSubmit}
                disabled={!sortieLead || !sortieDest || (!sortieBuddy && !soloOverride)}
                className="w-full h-11 rounded-xl bg-teal-500 hover:bg-teal-400 text-white font-bold text-xs shadow-lg shadow-teal-500/25 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirm Checkout & Log Sortie
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
