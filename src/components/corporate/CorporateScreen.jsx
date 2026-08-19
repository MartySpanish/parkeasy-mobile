// ParkEasy for Business, as one screen.
//
// Loads whatever the signed-in person has: their company's permit blocks, their
// own claims, and — if they administer the account — the admin view behind a
// toggle. Everything it reads comes through RLS, so a member of company A
// cannot pull company B's rows even by asking for them directly.
import React, { useCallback, useEffect, useState } from 'react';
import { X, Briefcase, AlertCircle } from 'lucide-react';
import { supabase, isSupabaseEnabled } from '../../supabase';
import PermitCalendar from './PermitCalendar';
import AdminPanel from './AdminPanel';
import { COPY, assertNoBayLanguage } from './copy';

// Run the vocabulary check once, at module load, in development. It throws, so
// a banned word cannot reach a screenshot let alone a customer.
if (import.meta.env?.DEV) {
  assertNoBayLanguage([COPY.disclaimer, COPY.guarantee, COPY.fullyBooked, COPY.access('X'), COPY.accessOn('X','Y')]);
}

export default function CorporateScreen({ onClose }) {
  const [state, setState] = useState({ loading: true });
  const [blockIdx, setBlockIdx] = useState(0);
  const [adminView, setAdminView] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseEnabled) { setState({ loading: false, error: 'Work parking needs an account.' }); return; }
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id;
      if (!uid) { setState({ loading: false, error: 'Sign in to see your work parking.' }); return; }

      // My membership rows. RLS returns only my own unless I am an admin.
      const { data: members, error: mErr } = await supabase
        .from('corporate_members')
        .select('id, corporate_account_id, role, status, full_name')
        .eq('user_id', uid).eq('status', 'active');
      if (mErr) throw mErr;
      if (!members?.length) { setState({ loading: false, empty: true }); return; }

      const accountIds = [...new Set(members.map(m => m.corporate_account_id))];
      const [{ data: accounts }, { data: blocks }, { data: claims }, { data: vehicles }] = await Promise.all([
        supabase.from('corporate_accounts').select('id, company_name').in('id', accountIds),
        supabase.from('corporate_permit_blocks')
          .select('id, corporate_account_id, listing_id, permit_count, start_date, end_date, status')
          .in('corporate_account_id', accountIds).eq('status', 'active'),
        supabase.from('permit_claims')
          .select('id, corporate_permit_block_id, claim_date, vrn, status')
          .in('corporate_member_id', members.map(m => m.id)),
        supabase.from('member_vehicles')
          .select('corporate_member_id, vrn, is_primary')
          .in('corporate_member_id', members.map(m => m.id)),
      ]);

      const listingIds = [...new Set((blocks || []).map(b => b.listing_id))];
      // listings_public, not rental_listings: the public view exposes the safe
      // columns and nothing else. Access instructions belong to the person who
      // holds a permit, not to anyone who can name the listing.
      const { data: listings } = listingIds.length
        ? await supabase.from('listings_public').select('id, title, address').in('id', listingIds)
        : { data: [] };
      const byListing = new Map((listings || []).map(l => [l.id, l]));
      const byAccount = new Map((accounts || []).map(a => [a.id, a]));

      const enriched = (blocks || []).map(b => {
        const mine = members.find(m => m.corporate_account_id === b.corporate_account_id);
        const v = (vehicles || []).filter(x => x.corporate_member_id === mine?.id);
        return {
          ...b,
          company_name: byAccount.get(b.corporate_account_id)?.company_name || 'Your company',
          car_park_name: byListing.get(b.listing_id)?.title || 'Your car park',
          car_park_address: byListing.get(b.listing_id)?.address || null,
          my_member_id: mine?.id || null,
          my_role: mine?.role || 'member',
          my_vrn: (v.find(x => x.is_primary) || v[0])?.vrn || null,
        };
      });

      setState({ loading: false, blocks: enriched, claims: claims || [] });
    } catch (e) {
      setState({ loading: false, error: e.message || 'Could not load your work parking.' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const block = state.blocks?.[blockIdx] || null;
  const claims = (state.claims || []).filter(c => c.corporate_permit_block_id === block?.id);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col" style={{background:'var(--bg-solid)'}}>
      <div className="sticky top-0 flex items-center gap-3 px-4 py-4 border-b border-white/10"
        style={{paddingTop:'calc(env(safe-area-inset-top) + 14px)', background:'var(--surface-solid)'}}>
        <button onClick={onClose} aria-label="Back"
          className="w-9 h-9 rounded-full bg-white/8 border border-white/15 flex items-center justify-center text-[#EAF1F8] active:scale-90 transition"><X size={16}/></button>
        <div className="flex items-center gap-2 min-w-0">
          <Briefcase size={18} className="text-[#5BE7DA] flex-shrink-0"/>
          <h2 className="font-display font-bold text-[#EAF1F8] text-lg truncate">
            {block?.company_name ? `${block.company_name} parking` : 'Work parking'}
          </h2>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-5" style={{maxWidth:680, margin:'0 auto', width:'100%'}}>
        {state.loading && <p className="text-[13px] text-[#8da2bd]">Loading your permits…</p>}

        {state.error && (
          <p className="rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed flex items-start gap-2"
            style={{background:'rgba(255,210,122,0.10)', border:'1px solid rgba(255,210,122,0.35)', color:'#FFD27A'}}>
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0"/><span>{state.error}</span>
          </p>
        )}

        {state.empty && (
          <div className="rounded-2xl p-4" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)'}}>
            <h3 className="font-display font-extrabold text-[17px] text-[#EAF1F8]">No work parking on this account yet</h3>
            <p className="text-[13px] text-[#cdd9e8] leading-relaxed mt-2">
              ParkEasy for Business lets an employer hold a block of monthly permits at a city-centre
              car park, which staff claim for the days they are actually in. If your workplace has one,
              ask them to invite the email address you signed up with.
            </p>
            <a href="mailto:parkeasyuk@gmail.com?subject=ParkEasy%20for%20Business"
              className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#5BE7DA]">
              Talk to us about setting one up →
            </a>
          </div>
        )}

        {state.blocks?.length > 1 && (
          <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
            {state.blocks.map((b, i) => (
              <button key={b.id} onClick={()=>setBlockIdx(i)}
                className={`flex-shrink-0 px-3 py-2 rounded-xl text-[12.5px] font-bold transition ${
                  i === blockIdx ? 'text-[#06231f] btn-teal' : 'text-[#cdd9e8] bg-white/6 border border-white/12'}`}>
                {b.car_park_name}
              </button>
            ))}
          </div>
        )}

        {block && block.my_role === 'admin' && (
          <div className="flex gap-1 p-1 rounded-xl mb-4" style={{background:'rgba(255,255,255,0.05)'}}>
            {[[false,'My permits'],[true,'Account']].map(([v,label]) => (
              <button key={label} onClick={()=>setAdminView(v)}
                className={`flex-1 py-2 rounded-lg text-[12.5px] font-bold transition ${
                  adminView === v ? 'bg-white/10 text-[#EAF1F8]' : 'text-[rgba(234,241,248,0.55)]'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {block && (adminView && block.my_role === 'admin'
          ? <AdminPanel block={block}/>
          : <PermitCalendar block={block} myClaims={claims} onChanged={load}/>)}
      </div>
    </div>
  );
}
