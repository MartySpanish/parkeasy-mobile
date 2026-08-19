// "Want your car washed while it's parked?"
//
// Shown on the booking confirmation, after the parking is already paid for —
// never as a step inside checkout. A driver mid-purchase is trying to finish;
// an add-on there is friction on the thing that makes money, to sell a thing
// that has never been sold.
//
// PARKEASY IS A BOOKING AGENT, and this component says so where the driver can
// read it before they commit, not in a footer. The wash is carried out by an
// independent contractor and the contract for it is with them.
import React, { useMemo, useState } from 'react';
import { Sparkles, AlertCircle, Check } from 'lucide-react';
import { WASH_TIERS, DISCLAIMER, CUTOFF_HOURS, availableWashDates, washDaysLabel } from '../../data/carWash';
import { supabase } from '../../supabase';

const longDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-GB',
  { weekday: 'long', day: 'numeric', month: 'long' });

export default function WashAddOn({ listing, bookingId, permitClaimId, vrn }) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState('standard');
  const [date, setDate] = useState(null);
  const [reg, setReg] = useState(vrn || '');
  const [state, setState] = useState('idle');
  const [err, setErr] = useState('');

  const days = listing?.wash_days?.length ? listing.wash_days : [1];
  const dates = useMemo(() => availableWashDates(days, new Date()), [days.join(',')]);

  // Nothing to offer: this site does not wash, or every date inside the window
  // is already past its cutoff. Say nothing rather than showing a dead form.
  if (!listing?.wash_enabled || dates.length === 0) return null;

  const chosen = date || dates[0];
  const price = WASH_TIERS.find(t => t.id === tier)?.pricePence ?? 0;

  const go = async () => {
    setState('sending'); setErr('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const r = await fetch('/api/wash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier, washDate: chosen, vrn: reg, bookingId, permitClaimId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || 'Could not start that.');
      window.location.href = d.url;
    } catch (e) { setErr(e.message); setState('idle'); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full mt-3 flex items-center gap-3 text-left rounded-2xl px-3.5 py-3 active:scale-[0.99] transition"
        style={{background:'linear-gradient(135deg, rgba(91,231,218,0.12), rgba(46,211,198,0.06))', border:'1px solid rgba(91,231,218,0.28)'}}>
        <span className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center"
          style={{background:'linear-gradient(135deg,#54E6D8,#2ED3C6)'}}>
          <Sparkles size={17} className="text-[#06231f]"/>
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13.5px] font-bold text-[#EAF1F8]">Want your car washed while it&rsquo;s parked?</span>
          <span className="block text-[11.5px] text-[rgba(234,241,248,0.55)] mt-0.5">
            From £{(WASH_TIERS[0].pricePence / 100).toFixed(0)} · {washDaysLabel(days)} at this site
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-2xl p-4" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(91,231,218,0.28)'}}>
      <p className="font-display font-extrabold text-[15px] text-[#EAF1F8]">Car wash while you&rsquo;re parked</p>
      <p className="text-[12px] text-[rgba(234,241,248,0.55)] mt-1 leading-relaxed">
        {washDaysLabel(days)} at {listing.title || 'this site'}. Requests close {CUTOFF_HOURS} hours before.
      </p>

      <div className="mt-3 space-y-2">
        {WASH_TIERS.map(t => (
          <button key={t.id} onClick={() => setTier(t.id)}
            className={`w-full flex items-center justify-between gap-3 text-left px-3.5 py-2.5 rounded-xl transition ${
              tier === t.id ? 'bg-[#2ED3C6]/12 border border-[#5BE7DA]/45' : 'bg-white/[0.04] border border-white/10'}`}>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-[#EAF1F8]">{t.label}</span>
              <span className="block text-[11px] text-[rgba(234,241,248,0.5)]">{t.hint}</span>
            </span>
            <span className="flex-shrink-0 text-[13px] font-extrabold text-[#5BE7DA]">£{(t.pricePence / 100).toFixed(0)}</span>
          </button>
        ))}
      </div>

      <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[rgba(234,241,248,0.5)] mt-3 mb-1.5">Which day</label>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {dates.slice(0, 4).map(d => (
          <button key={d} onClick={() => setDate(d)}
            className={`flex-shrink-0 px-3 py-2 rounded-xl text-[12px] font-bold transition ${
              chosen === d ? 'text-[#06231f] btn-teal' : 'text-[#cdd9e8] bg-white/6 border border-white/12'}`}>
            {new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          </button>
        ))}
      </div>

      <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[rgba(234,241,248,0.5)] mt-3 mb-1.5">Registration</label>
      <input value={reg} onChange={e => setReg(e.target.value.toUpperCase())}
        placeholder="BT21 ABC" aria-label="Vehicle registration" autoCapitalize="characters"
        className="w-full bg-white/[0.06] border border-white/12 rounded-xl px-3 py-2.5 text-[14px] font-mono tracking-wider text-[#EAF1F8] placeholder-[rgba(234,241,248,0.35)] focus:outline-none focus:ring-2 focus:ring-[#2ED3C6]/50"/>
      <p className="text-[11px] text-[rgba(234,241,248,0.45)] mt-1.5">So the valeter knows which car is yours.</p>

      {err && (
        <p className="mt-2.5 text-[12px] text-[#FFD27A] flex items-start gap-1.5">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0"/><span>{err}</span>
        </p>
      )}

      <button onClick={go} disabled={state === 'sending' || !reg.trim()}
        className="w-full mt-3 py-3.5 rounded-2xl font-display font-bold text-[15px] text-[#06231f] btn-teal active:scale-95 transition disabled:opacity-50">
        {state === 'sending' ? 'Starting…' : `Pay £${(price / 100).toFixed(2)} — ${longDate(chosen)}`}
      </button>
      <button onClick={() => setOpen(false)} className="w-full mt-2 py-2.5 text-[12.5px] font-bold text-[rgba(234,241,248,0.5)]">
        Not this time
      </button>

      {/* THE AGENT RELATIONSHIP, where it can be read before committing rather
          than in a footer afterwards. */}
      <p className="text-[11px] text-[rgba(234,241,248,0.45)] leading-relaxed mt-3 pt-3 border-t border-white/10 flex items-start gap-1.5">
        <Check size={12} className="mt-0.5 flex-shrink-0 text-[#5BE7DA]"/><span>{DISCLAIMER}</span>
      </p>
    </div>
  );
}
