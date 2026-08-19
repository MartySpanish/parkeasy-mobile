// Cancel a Premium subscription, in two taps.
//
// NO RETENTION INTERSTITIAL. No "are you sure you want to lose all this", no
// discount offer, no survey, no phone number. One tap to open, one to confirm,
// and a screen that states the exact date access ends.
//
// That is a deliberate product decision and not only a legal one. The FAQ used
// to tell subscribers to contact ParkEasy to cancel: every one of those is an
// email somebody has to answer, and a subscriber who cannot get out easily
// stops being a cancellation and becomes a chargeback. The DMCC Act 2024
// subscription regime — expected spring 2027 — will require this anyway.
//
// The subscription details shown above the button are the pre-contract
// information in the same sense: what it costs, how often, and when the next
// charge lands, said plainly before anybody has to ask for it.
import React, { useEffect, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { supabase, isSupabaseEnabled } from '../../supabase';

async function call(path, init) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Sign in to manage your subscription.');
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || 'Could not reach your subscription.');
  return body;
}

export default function CancelSubscription() {
  const [sub, setSub] = useState(undefined);   // undefined = loading, null = none
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!isSupabaseEnabled) { setSub(null); return; }
      try {
        const d = await call('/api/subscription', { method: 'GET' });
        if (live) setSub(d.subscription);
      } catch { if (live) setSub(null); }
    })();
    return () => { live = false; };
  }, []);

  // Nothing to cancel, and nothing to say about it. A "cancel subscription"
  // control on an account with no subscription is a control that can only
  // produce an error.
  if (sub === undefined || sub === null) return null;

  if (done) {
    return (
      <div className="rounded-xl px-3.5 py-3 mt-2" style={{background:'rgba(107,239,185,0.10)', border:'1px solid rgba(107,239,185,0.32)'}}>
        <p className="text-[13px] font-bold text-[#6BEFB9] flex items-center gap-1.5"><Check size={14}/>Subscription cancelled</p>
        <p className="text-[12.5px] text-[#cdd9e8] leading-relaxed mt-1">
          You won&rsquo;t be charged again. <strong className="text-[#EAF1F8]">You keep Premium until {done.ends_on}.</strong>{' '}
          We&rsquo;ve emailed you a copy.
        </p>
      </div>
    );
  }

  if (sub.cancel_at_period_end) {
    return (
      <div className="rounded-xl px-3.5 py-3 mt-2" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)'}}>
        <p className="text-[12.5px] text-[#cdd9e8] leading-relaxed">
          Your subscription is already cancelled. Premium runs until <strong className="text-[#EAF1F8]">{sub.renews_on}</strong>, then stops.
        </p>
      </div>
    );
  }

  const price = sub.amount_pence != null ? `£${(sub.amount_pence / 100).toFixed(2)}` : null;
  const every = sub.interval === 'year' ? 'a year' : sub.interval === 'month' ? 'a month' : null;

  return (
    <div className="mt-2">
      {/* Pre-contract information: what it costs, how often, when next. */}
      <p className="text-[11.5px] text-[rgba(234,241,248,0.5)] leading-relaxed">
        {price && every ? <>Premium, {price} {every}. Next payment {sub.renews_on}.</> : <>Next payment {sub.renews_on}.</>}
      </p>
      {!confirming ? (
        <button onClick={()=>setConfirming(true)}
          className="w-full mt-1.5 py-2 rounded-xl text-[12.5px] font-semibold text-[rgba(234,241,248,0.6)] bg-white/[0.05] border border-white/12 active:scale-[0.99] transition">
          Cancel subscription
        </button>
      ) : (
        <div className="mt-1.5 rounded-xl px-3.5 py-3" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)'}}>
          <p className="text-[12.5px] text-[#cdd9e8] leading-relaxed">
            You&rsquo;ll keep Premium until <strong className="text-[#EAF1F8]">{sub.renews_on}</strong> and won&rsquo;t be charged again.
          </p>
          {err && (
            <p className="text-[12px] text-[#FFD27A] mt-2 flex items-start gap-1.5">
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0"/><span>{err}</span>
            </p>
          )}
          <div className="flex gap-2 mt-2.5">
            <button onClick={()=>setConfirming(false)}
              className="flex-1 py-2 rounded-xl text-[12.5px] font-bold text-[#cdd9e8] bg-white/6 border border-white/12 active:scale-[0.99] transition">
              Keep it
            </button>
            <button disabled={busy} onClick={async ()=>{
                setBusy(true); setErr('');
                try { setDone(await call('/api/subscription', { method: 'POST', body: JSON.stringify({ action: 'cancel' }) })); }
                catch (e) { setErr(e.message); }
                finally { setBusy(false); }
              }}
              className="flex-1 py-2 rounded-xl text-[12.5px] font-bold text-red-300 bg-red-400/10 border border-red-400/35 active:scale-[0.99] transition disabled:opacity-50">
              {busy ? 'Cancelling…' : 'Yes, cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
