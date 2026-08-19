// Free spot and paid space, side by side, when there is a real choice to make.
//
// THE RULE THIS COMPONENT IS BUILT AROUND: show the free option FIRST and show
// it FAIRLY, including when it is the better answer.
//
// That is not politeness, it is the business. The free spots are why people
// open this app and why they subscribe; a comparison that quietly makes them
// look worse than they are would sell one booking and lose the reason anybody
// came. So the free side gets the same weight as the paid side, its real walk
// time, its real restrictions, and no hedging adjectives — and when nothing is
// actually wrong with it, this card does not appear at all.
//
// What the paid side is allowed to claim depends on whose car park it is: see
// data/spaceHold.js. A host site is genuinely held; an operator's is not.
import React, { useEffect, useRef } from 'react';
import { ChevronRight, Check, AlertCircle } from 'lucide-react';
import { trackFunnelCardShown, trackPaidListingClicked, markHotspotOrigin } from '../../funnel';

const walkMinutes = (metres) => Math.max(1, Math.round(metres / 80));

const Row = ({ children }) => (
  <li className="flex items-start gap-1.5 text-[12px] leading-snug">
    <span aria-hidden className="mt-[5px] w-1 h-1 rounded-full flex-shrink-0" style={{background:'currentColor',opacity:0.5}}/>
    <span>{children}</span>
  </li>
);

/**
 * @param spot      the free spot the driver is looking at
 * @param paid      { spot, listing, distanceM, allIn } — the bookable alternative
 * @param reason    'taken' | 'contested' | 'nearby' — why this is on screen
 * @param claim     claimState() for the free spot
 */
export default function ComparisonCard({ spot, paid, reason, claim, onOpenPaid }) {
  const walk = walkMinutes(paid.distanceM);
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    trackFunnelCardShown(reason, walk);
  }, [reason, walk]);

  const freeWalk = spot.walk || 'On the street';
  const heading = reason === 'taken'
    ? 'Every space we can see here is spoken for'
    : reason === 'contested'
      ? 'Someone else is already heading here'
      : 'There is a space you can book nearby';

  return (
    <div className="mt-4 rounded-2xl overflow-hidden" style={{border:'1px solid rgba(255,255,255,0.12)'}}>
      <div className="px-4 py-2.5 flex items-start gap-2" style={{background:'rgba(255,255,255,0.05)'}}>
        <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-[#FFD27A]"/>
        <p className="text-[12.5px] font-semibold text-[#EAF1F8] leading-snug">{heading}</p>
      </div>

      {/* THE FREE OPTION, FIRST AND UNVARNISHED. */}
      <div className="px-4 py-3.5" style={{background:'rgba(107,239,185,0.06)'}}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-display font-extrabold text-[15px] text-[#6BEFB9]">Free</p>
          <p className="text-[12px] font-semibold text-[rgba(234,241,248,0.6)] truncate">{spot.name}</p>
        </div>
        <ul className="mt-1.5 space-y-1 text-[rgba(234,241,248,0.7)]">
          <Row>{freeWalk}</Row>
          {spot.restriction && <Row>{spot.restriction}</Row>}
          {/* The honest limit, said plainly. ParkEasy sees its own users and
              nobody else, so it can say a space is claimed and never that it
              is full — a wrong "full" sends a driver past an empty space,
              which is the one error this app exists to prevent. */}
          <Row>
            {claim?.atCapacity
              ? 'Every space we can see is claimed by other ParkEasy drivers — there may still be room.'
              : claim?.contested
                ? `${claim.others} other driver${claim.others === 1 ? '' : 's'} on the way. Still worth a look.`
                : 'First come, first served — no guarantee it will be there.'}
          </Row>
        </ul>
        {/* Said out loud, because it is often true and hiding it would be the
            dark pattern this card exists to avoid. */}
        <p className="text-[11.5px] text-[rgba(234,241,248,0.45)] mt-2">
          Still free to try. You are already here — have a look before you pay for anything.
        </p>
      </div>

      {/* THE PAID OPTION. */}
      <button onClick={() => { trackPaidListingClicked(reason, walk); markHotspotOrigin(); onOpenPaid?.(paid); }}
        className="w-full text-left px-4 py-3.5 active:scale-[0.995] transition"
        style={{background:'rgba(46,211,198,0.10)', borderTop:'1px solid rgba(255,255,255,0.10)'}}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-display font-extrabold text-[15px] text-[#5BE7DA]">
            {paid.allIn ? `£${paid.allIn.total.toFixed(2)}` : 'Bookable'}
          </p>
          <p className="text-[12px] font-semibold text-[rgba(234,241,248,0.6)] truncate">{paid.spot.name}</p>
        </div>
        <ul className="mt-1.5 space-y-1 text-[#cdd9e8]">
          <Row>{walk} min walk</Row>
          <Row>
            {paid.listing?.is_operator_site
              ? 'Guaranteed entry — spaces inside are first come, first served'
              : 'Guaranteed access, held for you'}
          </Row>
          <Row>Paid in advance, your registration is on the list</Row>
        </ul>
        <span className="mt-2.5 inline-flex items-center gap-1 text-[12.5px] font-bold text-[#5BE7DA]">
          <Check size={13}/>See this space<ChevronRight size={14}/>
        </span>
        {paid.allIn && (
          <p className="text-[11px] text-[rgba(234,241,248,0.4)] mt-1.5">
            All in, including the ParkEasy service fee.
          </p>
        )}
      </button>
    </div>
  );
}

export { walkMinutes };
