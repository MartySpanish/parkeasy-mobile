// The staff screen: a calendar of the days you can claim a permit.
//
// Green = permits available, amber = one left, grey = full. Tap a date to
// claim, tap again to hand it back.
//
// WHAT THIS SCREEN IS NOT ALLOWED TO SAY: see copy.js. A permit is a right of
// entry against a quota, not a bay ParkEasy can reserve at somebody else's car
// park. The disclaimer sits under the calendar rather than in small print at
// the bottom, because it is the difference between the promise ParkEasy keeps
// and the one it cannot.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Check, X, MapPin, Car, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { COPY } from './copy';
import { getAvailability, claimPermit, cancelClaim } from './api';

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const startOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const endOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const MONTH = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const longDate = (s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
};

// Green / amber / grey, and the reason in words as well as colour — a
// colour-only state is unreadable to about one man in twelve.
function tone(day, today) {
  if (!day || day.date < today) return { key: 'past',  bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)', text: 'rgba(234,241,248,0.25)', label: 'in the past' };
  if (day.claimed_by_me)       return { key: 'mine',  bg: 'rgba(46,211,198,0.22)',  border: '#2ED3C6',                text: '#EAF1F8',                 label: 'you have a permit' };
  if (day.permits_total === 0) return { key: 'none',  bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)', text: 'rgba(234,241,248,0.25)', label: 'not covered' };
  if (day.available === 0)     return { key: 'full',  bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)', text: 'rgba(234,241,248,0.35)', label: 'full' };
  if (day.available === 1)     return { key: 'last',  bg: 'rgba(255,210,122,0.16)', border: 'rgba(255,210,122,0.55)', text: '#FFD27A',                 label: 'one permit left' };
  return                              { key: 'free',  bg: 'rgba(107,239,185,0.14)', border: 'rgba(107,239,185,0.45)', text: '#6BEFB9',                 label: 'permits available' };
}

export default function PermitCalendar({ block, myClaims = [], onChanged }) {
  const today = iso(new Date());
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [days, setDays] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState('');

  const from = useMemo(() => iso(startOfMonth(cursor)), [cursor]);
  const to = useMemo(() => iso(endOfMonth(cursor)), [cursor]);

  const load = useCallback(async () => {
    setErr('');
    try {
      const data = await getAvailability(block.id, from, to);
      setDays(data.dates || []);
    } catch (e) { setErr(e.message); setDays([]); }
  }, [block.id, from, to]);

  useEffect(() => { load(); }, [load]);

  const byDate = useMemo(() => new Map((days || []).map(d => [d.date, d])), [days]);

  // Monday-first grid with the leading blanks a UK calendar expects.
  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const lead = (first.getUTCDay() + 6) % 7;
    const last = endOfMonth(cursor).getUTCDate();
    const out = Array.from({ length: lead }, () => null);
    for (let i = 1; i <= last; i++) out.push(iso(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), i))));
    return out;
  }, [cursor]);

  const act = async (date) => {
    const day = byDate.get(date);
    if (!day || date < today) return;
    setBusy(date); setErr(''); setNote('');
    try {
      if (day.claimed_by_me) {
        const mine = myClaims.find(c => c.claim_date === date && c.status === 'claimed');
        if (!mine) throw new Error('Could not find that permit to cancel.');
        await cancelClaim(mine.id);
        setNote(`Permit handed back for ${longDate(date)}. Someone else can use it now.`);
      } else {
        await claimPermit(block.id, date);
        setNote(COPY.accessOn(block.car_park_name, longDate(date)) + '.');
      }
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e.nextAvailable
        ? `${e.message} The next date with a permit free is ${longDate(e.nextAvailable)}.`
        : e.message);
    } finally { setBusy(null); }
  };

  return (
    <div>
      <div className="rounded-2xl p-4" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)'}}>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#5BE7DA]">{COPY.guarantee}</p>
        <h3 className="font-display font-extrabold text-[18px] text-[#EAF1F8] leading-tight mt-1">{block.car_park_name}</h3>
        {block.car_park_address && (
          <p className="text-[12.5px] text-[#8da2bd] mt-1 flex items-start gap-1.5">
            <MapPin size={13} className="mt-0.5 flex-shrink-0 text-[#5BE7DA]"/><span>{block.car_park_address}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
          <span className="text-[12px] text-[#cdd9e8]">
            <strong className="text-[#EAF1F8]">{block.permit_count}</strong> {block.permit_count === 1 ? COPY.permitOne : COPY.permitMany} a day
          </span>
          {block.my_vrn && (
            <span className="text-[12px] text-[#cdd9e8] inline-flex items-center gap-1.5">
              <Car size={13} className="text-[#5BE7DA]"/>{block.my_vrn}
            </span>
          )}
        </div>
        {block.access_instructions && (
          <p className="text-[12.5px] text-[#cdd9e8] leading-relaxed mt-2.5 pt-2.5 border-t border-white/10">
            {block.access_instructions}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between mt-4">
        <button onClick={()=>setCursor(c => new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() - 1, 1)))}
          aria-label="Previous month"
          className="w-9 h-9 rounded-full bg-white/8 border border-white/15 flex items-center justify-center text-[#EAF1F8] active:scale-90 transition">
          <ChevronLeft size={16}/>
        </button>
        <p className="font-display font-bold text-[15px] text-[#EAF1F8]">
          {MONTH[cursor.getUTCMonth()]} {cursor.getUTCFullYear()}
        </p>
        <button onClick={()=>setCursor(c => new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1)))}
          aria-label="Next month"
          className="w-9 h-9 rounded-full bg-white/8 border border-white/15 flex items-center justify-center text-[#EAF1F8] active:scale-90 transition">
          <ChevronRight size={16}/>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mt-3" role="grid" aria-label="Permit availability">
        {DOW.map(d => (
          <div key={d} className="text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[rgba(234,241,248,0.35)] py-1">{d}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`b${i}`}/>;
          const day = byDate.get(date);
          const t = tone(day, today);
          const dayNum = Number(date.slice(8, 10));
          const disabled = !day || date < today || (day.permits_total === 0) || (day.available === 0 && !day.claimed_by_me);
          return (
            <button key={date} onClick={()=>act(date)} disabled={disabled || busy === date}
              aria-label={`${longDate(date)} — ${t.label}${day && day.permits_total ? `, ${day.available} of ${day.permits_total} left` : ''}`}
              className="rounded-xl py-2 flex flex-col items-center justify-center transition active:scale-95 disabled:active:scale-100"
              style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, minHeight: 52,
                       cursor: disabled ? 'default' : 'pointer', opacity: busy === date ? 0.5 : 1 }}>
              <span className="text-[13px] font-bold leading-none">{dayNum}</span>
              {day?.claimed_by_me
                ? <Check size={12} className="mt-1"/>
                : day && day.permits_total > 0 && date >= today
                  ? <span className="text-[9.5px] font-semibold leading-none mt-1">{day.available === 0 ? 'full' : day.available}</span>
                  : <span className="mt-1 block h-[9.5px]"/>}
            </button>
          );
        })}
      </div>

      {/* Colour is never the only signal. */}
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 mt-3">
        {[['#6BEFB9','permits free'],['#FFD27A','one left'],['rgba(234,241,248,0.35)','full'],['#2ED3C6','yours']].map(([c,l])=>(
          <span key={l} className="inline-flex items-center gap-1.5 text-[11px] text-[rgba(234,241,248,0.55)]">
            <span aria-hidden className="w-2.5 h-2.5 rounded-full" style={{background:c}}/>{l}
          </span>
        ))}
      </div>

      {note && (
        <p className="mt-3 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed"
          style={{background:'rgba(46,211,198,0.12)', border:'1px solid rgba(91,231,218,0.32)', color:'#EAF1F8'}}>{note}</p>
      )}
      {err && (
        <p className="mt-3 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed flex items-start gap-2"
          style={{background:'rgba(255,210,122,0.10)', border:'1px solid rgba(255,210,122,0.35)', color:'#FFD27A'}}>
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0"/><span>{err}</span>
        </p>
      )}

      <h4 className="font-display font-bold text-[14px] text-[#EAF1F8] mt-5 mb-2">Your permits</h4>
      {myClaims.filter(c => c.status === 'claimed' && c.claim_date >= today).length === 0 ? (
        <p className="text-[12.5px] text-[#8da2bd]">None claimed yet — tap a green day above.</p>
      ) : (
        <div className="divide-y divide-white/5">
          {myClaims.filter(c => c.status === 'claimed' && c.claim_date >= today)
            .sort((a,b)=>a.claim_date.localeCompare(b.claim_date))
            .map(c => (
            <div key={c.id} className="py-2.5 flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-[#EAF1F8]">{longDate(c.claim_date)}</span>
                <span className="block text-[11.5px] text-[rgba(234,241,248,0.5)]">{block.car_park_name} · {c.vrn}</span>
              </span>
              <button onClick={()=>act(c.claim_date)} disabled={busy === c.claim_date}
                className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] font-bold text-[rgba(234,241,248,0.55)] px-2.5 py-1.5 rounded-lg bg-white/6 border border-white/12 active:scale-95 transition">
                <X size={12}/>Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11.5px] text-[rgba(234,241,248,0.45)] leading-relaxed mt-4 rounded-xl px-3.5 py-3"
        style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)'}}>
        {COPY.disclaimer}
      </p>
    </div>
  );
}

export { longDate, tone };
