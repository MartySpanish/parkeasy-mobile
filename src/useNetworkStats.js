// The network's headline numbers, from the one file that computes them.
//
// WHY THIS EXISTS. Six places print "how big is ParkEasy": the prerendered SEO
// text, the three meta descriptions, the globe card, the homepage hero, the
// welcome screen and the admin dashboard's App data tiles. Every one of them
// was counting the BUNDLED arrays — 744 spots, 89 gems — which is the fallback
// list the app uses only when the hidden_gems query fails. The live table holds
// 133 published gems, so all six were quoting a number no subscriber sees.
//
// public/globe/places.json is written by scripts/generate-globe-data.mjs during
// the build, and its stats block already reconciles the two: non-gem spots plus
// the live gem count, so the total and the "including N hidden gems" clause
// describe one set. This hook is how a React component reads it.
//
// ONE REQUEST, however many components ask. The promise is cached at module
// scope rather than per-component, so the welcome screen and the admin
// dashboard mounting together do not fetch it twice.
import { useState, useEffect } from 'react';

let cached = null;      // the resolved stats, once we have them
let inFlight = null;    // the shared promise while we do not

const load = () => {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = fetch('/globe/places.json')
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      const s = d?.stats;
      // Only accept a stats block that actually carries the three numbers. A
      // half-written one falls back to the bundled counts rather than
      // rendering a confident-looking zero.
      if (s && Number.isInteger(s.spaces) && Number.isInteger(s.gems) && Number.isInteger(s.towns)) {
        cached = s;
        return s;
      }
      return null;
    })
    .catch(() => null)     // offline, or Capacitor with no such path: use the fallback
    .finally(() => { inFlight = null; });
  return inFlight;
};

/**
 * @param fallback the bundled counts, used until (or unless) the file loads.
 *                 Always render something: these numbers sit in sentences.
 */
export function useNetworkStats(fallback) {
  const [stats, setStats] = useState(cached);
  useEffect(() => {
    let alive = true;
    load().then(s => { if (alive && s) setStats(s); });
    return () => { alive = false; };
  }, []);
  return stats || fallback || null;
}
