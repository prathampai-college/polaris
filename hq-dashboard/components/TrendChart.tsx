'use client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function TrendChart({ data, unit='L' }: { data: { day: string; qty: number; forecast?: number }[]; unit?: string }) {
  return (
    <div className="bg-black/20 rounded p-2 border border-white/10" style={{ width: '100%', height: 120 }}>
      <div className="text-xs text-white/50 mb-1">TimescaleDB • diesel level • {unit} (blue=actual, red=forecast)</div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#666' }} />
          <YAxis tick={{ fontSize: 10, fill: '#666' }} />
          <Tooltip contentStyle={{ backgroundColor: '#000', borderColor: '#333', fontSize: 12 }} />
          <Line type="monotone" dataKey="qty" stroke="#3B82F6" strokeWidth={2} dot={{ r: 2 }} />
          <Line type="monotone" dataKey="forecast" stroke="#EF4444" strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProcurementTable({ rows }: { rows: { sku: string; name: string; need: number; unit: string; eta: string; cost: string }[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-white/50"><tr><th className="text-left p-1">SKU</th><th>Need</th><th>ETA before freeze</th><th>Cost</th></tr></thead>
      <tbody>
        {rows.map(r=>(
          <tr key={r.sku} className="border-t border-white/5">
            <td className="p-1 font-mono">{r.sku}<br/><span className="text-white/50 text-[11px]">{r.name}</span></td>
            <td className="text-center">{r.need} {r.unit}</td>
            <td className="text-center">{r.eta}</td>
            <td className="text-center">{r.cost}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
