// The employer admin screen: what the block holds, who is using it, and what
// the operator needs handed to them.
//
// Deliberately thin on chrome. The person opening this is an office manager
// checking whether they are paying for permits nobody claims, and the honest
// answer to that is four numbers and a list.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Download, AlertCircle, TrendingUp } from 'lucide-react';
import { getAvailability, getPlateList, plateListCsvUrl } from './api';
import { COPY } from './copy';
import { longDate } from './PermitCalendar';

const iso = (d) => d.toISOString().slice(0, 10);

export default function AdminPanel({ block }) {
  const today = iso(new Date());
  const [days, setDays] = useState(null);
  const [plateDate, setPlateDate] = useState(today);
  const [plates, setPlates] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try {
      const horizon = new Date(); horizon.setUTCDate(horizon.getUTCDate() + 41);
      const data = await getAvailability(block.id, today, iso(horizon));
      setDays(data.dates || []);
    } catch (e) { setErr(e.message); }
  }, [block.id, today]);

  useEffect(() => { load(); }, [load]);

  const loadPlates = useCallback(async (date) => {
    setBusy(true); setErr('');
    try { setPlates(await getPlateList(block.id, date)); }
    catch (e) { setErr(e.message); setPlates(null); }
    finally { setBusy(false); }
  }, [block.id]);

  useEffect(() => { loadPlates(plateDate); }, [loadPlates, plateDate]);

  // Utilisation over the days that have actually happened this month, not over
  // the whole month — a figure that counts days nobody could have claimed yet
  // reads as "nobody uses this" on the 3rd.
  const stats = useMemo(() => {
    if (!days) return null;
    const month = today.slice(0, 7);
    const elapsed = days.filter(d => d.date.slice(0, 7) === month && d.date <= today && d.permits_total > 0);
    const capacity = elapsed.reduce((a, d) => a + d.permits_total, 0);
    const used = elapsed.reduce((a, d) => a + d.permits_claimed, 0);
    const todayRow = days.find(d => d.date === today);
    return {
      claimedToday: todayRow?.permits_claimed ?? 0,
      totalToday: todayRow?.permits_total ?? block.permit_count,
      utilisation: capacity ? Math.round((used / capacity) * 100) : null,
      elapsedDays: elapsed.length,
    };
  }, [days, today, block.permit_count]);

  const downloadCsv = async () => {
    setBusy(true); setErr('');
    try {
      const url = await plateListCsvUrl(block.id, plateDate);
      const a = document.createElement('a');
      a.href = url; a.download = `parkeasy-permits-${plateDate.replace(/-/g,'')}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const Stat = ({ value, label }) => (
    <div className="rounded-2xl px-3 py-3 text-center" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)'}}>
      <p className="font-display font-extrabold text-[20px] text-[#EAF1F8] leading-none">{value}</p>
      <p className="text-[10.5px] text-[rgba(234,241,248,0.5)] mt-1.5 leading-tight">{label}</p>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat value={block.permit_count} label={`${COPY.permitMany} held`}/>
        <Stat value={stats ? `${stats.claimedToday}/${stats.totalToday}` : '—'} label="claimed today"/>
        <Stat value={stats?.utilisation != null ? `${stats.utilisation}%` : '—'} label="used this month"/>
        <Stat value={block.member_count ?? '—'} label="staff on the account"/>
      </div>
      {stats?.utilisation != null && stats.elapsedDays > 0 && (
        <p className="text-[11.5px] text-[rgba(234,241,248,0.45)] mt-2 flex items-start gap-1.5">
          <TrendingUp size={12} className="mt-0.5 flex-shrink-0 text-[#5BE7DA]"/>
          <span>
            Across the {stats.elapsedDays} day{stats.elapsedDays === 1 ? '' : 's'} of this month so far.
            {stats.utilisation < 50 && ' Fewer than half your permits are being claimed — you may be paying for more than you need.'}
          </span>
        </p>
      )}

      <h4 className="font-display font-bold text-[14px] text-[#EAF1F8] mt-5 mb-2">Next six weeks</h4>
      {/* Density, not a second calendar. The question an admin has is "which
          days are we short", and a row of bars answers it in one look. */}
      <div className="flex items-end gap-[3px] rounded-2xl px-3 py-3" style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', height:96}}>
        {(days || []).filter(d => d.permits_total > 0).map(d => {
          const pct = d.permits_total ? d.permits_claimed / d.permits_total : 0;
          const col = pct >= 1 ? '#FFD27A' : pct >= 0.7 ? '#54E6D8' : 'rgba(91,231,218,0.45)';
          return (
            <span key={d.date} title={`${longDate(d.date)} — ${d.permits_claimed}/${d.permits_total}`}
              className="flex-1 rounded-sm" style={{ height: `${Math.max(4, pct * 100)}%`, background: col, minWidth: 2 }}/>
          );
        })}
      </div>

      <h4 className="font-display font-bold text-[14px] text-[#EAF1F8] mt-5 mb-2">Vehicles for a day</h4>
      <p className="text-[12px] text-[rgba(234,241,248,0.5)] leading-relaxed mb-2">
        The list the car park operator needs. Download it as a CSV and send it on.
      </p>
      <div className="flex gap-2">
        <input type="date" value={plateDate} min={block.start_date || undefined} max={block.end_date || undefined}
          onChange={e => setPlateDate(e.target.value)} aria-label="Date for the vehicle list"
          className="flex-1 min-w-0 bg-white/[0.06] border border-white/12 rounded-xl px-3 py-2.5 text-[13px] text-[#EAF1F8] focus:outline-none focus:ring-2 focus:ring-[#2ED3C6]/50"/>
        <button onClick={downloadCsv} disabled={busy || !plates?.vehicles?.length}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 rounded-xl text-[12.5px] font-bold text-[#06231f] btn-teal active:scale-95 transition disabled:opacity-50">
          <Download size={14}/>CSV
        </button>
      </div>

      {plates && (
        <div className="mt-2.5">
          <p className="text-[12px] text-[rgba(234,241,248,0.55)] mb-1.5">
            <Users size={12} className="inline -mt-0.5 mr-1 text-[#5BE7DA]"/>
            {plates.permits_claimed} of {plates.permits_total} {COPY.permitMany} claimed for {longDate(plateDate)}
          </p>
          {plates.vehicles.length === 0 ? (
            <p className="text-[12.5px] text-[#8da2bd]">Nobody has claimed a permit for that day.</p>
          ) : (
            <div className="divide-y divide-white/5">
              {plates.vehicles.map(v => (
                <div key={v.claim_id} className="py-2 flex items-center justify-between gap-3">
                  <span className="text-[13px] font-mono font-bold text-[#EAF1F8] tracking-wide">{v.vrn}</span>
                  <span className="text-[12px] text-[rgba(234,241,248,0.5)] truncate">{v.driver_name || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {err && (
        <p className="mt-3 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed flex items-start gap-2"
          style={{background:'rgba(255,210,122,0.10)', border:'1px solid rgba(255,210,122,0.35)', color:'#FFD27A'}}>
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0"/><span>{err}</span>
        </p>
      )}
    </div>
  );
}
