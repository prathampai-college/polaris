'use client';
import { useEffect, useMemo, useState } from 'react';
import { useDashboard } from '../../../lib/context';
import { api, ApiError } from '../../../lib/api';
import { Badge } from '../../../components/ui/badge';

type Emergency = { id: string; type?: string; status: string; station_id: string; ts?: string; location_coord?: string; reported_by?: string };
type Personnel = { id: string; name: string; blood_group?: string; role?: string; emergency_contact?: string; status?: string };
type Sortie = { id: string; destination?: string; lead_name?: string; lead_personnel_id?: string; safety_status: string; departure_time?: string; expected_return_time?: string };

export default function PersonnelPage() {
  const { selectedStation, stationName, pushToast } = useDashboard();
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [sorties, setSorties] = useState<Sortie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<Emergency[]>('/emergencies'),
      api.get<Personnel[]>(`/personnel?station_id=${selectedStation}`),
      api.get<Sortie[]>(`/sorties?station_id=${selectedStation}`),
    ])
      .then(([em, per, sor]) => {
        setEmergencies(em || []);
        setPersonnel(per || []);
        setSorties(sor || []);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStation]);

  const activeEmergencies = useMemo(() => emergencies.filter((e) => e.status !== 'RESOLVED'), [emergencies]);

  async function triageEmergencyHQ(emergencyId: string, status: string) {
    try {
      await api.patch(`/emergency/${emergencyId}`, { status, actor_id: 'HQ_COMMAND' });
      pushToast(`Emergency → ${status}`);
      load();
    } catch (e) {
      pushToast(e instanceof ApiError ? e.message : 'triage error');
    }
  }
  const resolveEmergencyHQ = (id: string) => triageEmergencyHQ(id, 'RESOLVED');

  if (error) {
    return (
      <div className="border border-flare/40 bg-flare/5 p-4 text-xs text-flare">
        Couldn't load personnel data: {error}. Check the HQ API is reachable.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Active Distress Beacons & Incident Command */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="display text-lg text-ink flex items-center gap-2">
              Active Distress Beacons &amp; Incident Command
              {activeEmergencies.length > 0 && <Badge variant="critical">{activeEmergencies.length} ACTIVE</Badge>}
            </h2>
            <p className="text-xs text-slate">Distress signals routed from field tablets via DTN mesh &amp; gateway</p>
          </div>
          <span className="eyebrow">{stationName}</span>
        </div>

        <div className="space-y-2">
          {emergencies.map((em) => {
            const isResolved = em.status === 'RESOLVED';
            return (
              <div
                key={em.id}
                className={`p-3.5 border flex items-center justify-between flex-wrap gap-2 ${
                  isResolved ? 'border-structure/40 bg-canvas' : 'border-flare bg-flare/5'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={isResolved ? 'neutral' : 'critical'}>{em.type?.replace('SOS_', '') || 'SOS'}</Badge>
                    <span className="font-mono text-xs font-bold text-ink">{em.id}</span>
                    <span className="text-xs text-cobalt font-bold">{em.station_id}</span>
                    <span className="text-[11px] text-slate font-mono">{em.ts?.slice(0, 19).replace('T', ' ')}</span>
                  </div>
                  <div className="text-xs text-slate">
                    Location: <b className="text-ink">{em.location_coord || 'Unknown'}</b> · Reported by: <b className="text-ink">{em.reported_by}</b>
                  </div>
                </div>

                <div className="flex gap-2">
                  {!isResolved ? (
                    <>
                      {em.status === 'ACTIVE' && (
                        <button
                          onClick={() => triageEmergencyHQ(em.id, 'ACK')}
                          className="px-3.5 py-1.5 border border-structure font-mono text-xs font-bold text-ink hover:bg-structure hover:text-canvas"
                        >
                          ACK
                        </button>
                      )}
                      {(em.status === 'ACTIVE' || em.status === 'ACK') && (
                        <button
                          onClick={() => triageEmergencyHQ(em.id, 'RESPONDING')}
                          className="px-3.5 py-1.5 border border-cobalt bg-cobalt/10 font-mono text-xs font-bold text-cobalt hover:bg-cobalt hover:text-white"
                        >
                          Responding →
                        </button>
                      )}
                      <button
                        onClick={() => confirm(`Mark ${em.id} RESOLVED? This closes the incident for every station.`) && resolveEmergencyHQ(em.id)}
                        className="px-3.5 py-1.5 border border-structure bg-ink font-mono text-xs font-bold text-canvas hover:bg-cobalt"
                      >
                        Resolved ✓
                      </button>
                    </>
                  ) : (
                    <span className="text-xs font-mono font-bold text-slate">RESOLVED ✓</span>
                  )}
                </div>
              </div>
            );
          })}
          {emergencies.length === 0 && (
            <div className="text-center py-8 text-xs text-slate">No active or past distress alerts recorded. All stations reporting nominal.</div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Station Crew & Muster Roll */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base text-ink">Station Crew &amp; Muster Roll</h3>
              <p className="text-xs text-slate">{personnel.length} winter expeditioners assigned</p>
            </div>
            <span className="eyebrow">{stationName}</span>
          </div>

          <div className="space-y-2 max-h-[460px] overflow-y-auto scroll-thin pr-1">
            {personnel.map((p) => (
              <div key={p.id} className="border border-structure p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-ink">{p.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 border border-structure font-mono font-bold text-slate">{p.blood_group}</span>
                  </div>
                  <div className="text-xs text-slate">{p.role}</div>
                  <div className="text-[11px] text-slate font-mono mt-0.5">ID: {p.id} · Emergency: {p.emergency_contact || 'Base UHF'}</div>
                </div>

                <Badge variant={p.status === 'ON_STATION' ? 'neutral' : p.status === 'FIELD_SORTIE' ? 'active' : 'warning'}>
                  {p.status?.replace('_', ' ')}
                </Badge>
              </div>
            ))}
            {personnel.length === 0 && <div className="text-center py-10 text-xs text-slate">No personnel records found for this station.</div>}
          </div>
        </div>

        {/* Outdoor Sorties & Traverses */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base text-ink">Outdoor Sorties &amp; Traverses</h3>
              <p className="text-xs text-slate">Field scientific sorties and supply convoys</p>
            </div>
            <span className="eyebrow">{sorties.length} logged</span>
          </div>

          <div className="space-y-2 max-h-[460px] overflow-y-auto scroll-thin pr-1">
            {sorties.map((s) => {
              const isActive = s.safety_status === 'ACTIVE';
              const isOverdue = isActive && !!s.expected_return_time && new Date(s.expected_return_time).getTime() < Date.now();
              return (
                <div key={s.id} className={`border p-3.5 space-y-2 ${isOverdue ? 'border-flare bg-flare/5' : 'border-structure'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm text-ink flex items-center gap-2">
                        <span>{s.destination}</span>
                        {isOverdue && <Badge variant="critical">OVERDUE</Badge>}
                      </div>
                      <div className="text-xs text-slate mt-0.5">
                        Team Lead: <b className="text-ink">{s.lead_name || s.lead_personnel_id}</b>
                      </div>
                    </div>

                    <Badge variant={s.safety_status === 'RETURNED' ? 'neutral' : s.safety_status === 'EMERGENCY' ? 'critical' : 'live'}>
                      {s.safety_status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate pt-1 border-t border-structure/30">
                    <div>Departed: {s.departure_time?.slice(11, 16) || '—'}</div>
                    <div>Expected: {s.expected_return_time?.slice(11, 16) || '—'}</div>
                  </div>
                </div>
              );
            })}
            {sorties.length === 0 && <div className="text-center py-10 text-xs text-slate">No active or recorded sorties.</div>}
          </div>
        </div>
      </div>

      {loading && personnel.length === 0 && sorties.length === 0 && emergencies.length === 0 && (
        <div className="text-xs text-slate">Loading personnel & incident data…</div>
      )}
    </div>
  );
}
