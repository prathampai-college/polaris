'use client';
export function TrendChart({ data, unit='L' }: { data: { day: string; qty: number; forecast?: number }[]; unit?: string }) {
  const max = Math.max(...data.map(d=> Math.max(d.qty, d.forecast??0))) * 1.1;
  const min = Math.min(...data.map(d=> d.qty)) * 0.9;
  const h=80, w=320, pad=10;
  const xScale = (i:number)=> pad + (i/(data.length-1))*(w-pad*2);
  const yScale = (v:number)=> h - pad - ((v-min)/(max-min))*(h-pad*2);
  const pathQty = data.map((d,i)=> `${i===0?'M':'L'} ${xScale(i)} ${yScale(d.qty)}`).join(' ');
  const pathFc = data.filter(d=>d.forecast).map((d,i)=> {
    const idx=data.indexOf(d);
    return `${i===0?'M':'L'} ${xScale(idx)} ${yScale(d.forecast!)}`;
  }).join(' ');
  return (
    <div className="bg-black/20 rounded p-2 border border-white/10">
      <div className="text-xs text-white/50 mb-1">TimescaleDB • diesel level • {unit} (solid=actual, dashed=forecast)</div>
      <svg width={w} height={h} className="w-full">
        <line x1={pad} x2={w-pad} y1={h-pad} y2={h-pad} stroke="rgba(255,255,255,0.1)" />
        <path d={pathQty} fill="none" stroke="#3B82F6" strokeWidth={2} />
        <path d={pathFc} fill="none" stroke="#EF4444" strokeWidth={1.5} strokeDasharray="4 3" />
        {data.map((d,i)=>(
          <g key={i}>
            <circle cx={xScale(i)} cy={yScale(d.qty)} r={2} fill="#3B82F6" />
            {d.forecast && <circle cx={xScale(i)} cy={yScale(d.forecast)} r={2} fill="#EF4444" />}
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-white/40">
        {data.map(d=><span key={d.day}>{d.day}</span>)}
      </div>
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
