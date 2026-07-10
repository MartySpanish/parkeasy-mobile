// Geocoding + address autocomplete.
// Prefers Google when a Maps key is configured, using the NEW Places API
// (AutocompleteSuggestion + Place) — the legacy AutocompleteService is not
// available to Google projects created after March 2025. Falls back to free
// OpenStreetMap Nominatim on any failure, so search always works.

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
export const hasGoogle = !!GOOGLE_MAPS_KEY;

// Northern Ireland bias box (lng/lat extents) for Nominatim.
const NI_VIEWBOX = '-8.3,55.45,-5.3,54.0';
// NI-centred circle to bias Google predictions toward local results.
const NI_BIAS = { center: { lat: 54.62, lng: -6.6 }, radius: 140000 };

// ── Google Maps JS loader (async bootstrap + importLibrary) ───────────────────
// The modern loader exposes google.maps.importLibrary; classes come from
// importLibrary('places') / importLibrary('geocoding'). A gm_authFailure means
// the key/API/billing isn't right — we record it and fall back to Nominatim.
let bootstrapPromise = null;
const loadBootstrap = () => {
  if (!GOOGLE_MAPS_KEY) return Promise.reject(new Error('no key'));
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearInterval(poll);
      ok ? resolve() : reject(new Error('google maps unavailable'));
    };
    // Auth failures (bad key restriction, API not enabled, billing off) trigger
    // this global. Surface it for diagnostics, then fall back to Nominatim.
    window.gm_authFailure = () => {
      try { localStorage.setItem('pe_gmap_error', 'auth-failed'); } catch { /* ignore */ }
      finish(false);
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&v=weekly&libraries=places,geocoding&loading=async`;
    s.async = true;
    s.onerror = () => finish(false);
    const poll = setInterval(() => { if (window.google?.maps?.importLibrary) finish(true); }, 100);
    const timer = setTimeout(() => finish(false), 8000);
    document.head.appendChild(s);
  });
  bootstrapPromise.catch(() => { bootstrapPromise = null; }); // allow retry
  return bootstrapPromise;
};
const placesLib = async () => { await loadBootstrap(); return window.google.maps.importLibrary('places'); };
const geocodingLib = async () => { await loadBootstrap(); return window.google.maps.importLibrary('geocoding'); };

// Diagnostic: the last Google failure reason, surfaced in the UI via ?debug=1
// so we can see exactly why Google fell back (billing, API not enabled, etc.).
const setDiag = (m) => { try { if (typeof window !== 'undefined') window.__peGeoError = m; } catch { /* ignore */ } };
export const lastGeoError = () => (typeof window !== 'undefined' ? window.__peGeoError : '') || '';

// ── Nominatim helpers (fallback) ──────────────────────────────────────────────
const nominatimSuggest = async (term) => {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&countrycodes=gb&viewbox=${NI_VIEWBOX}&q=${encodeURIComponent(term)}`, { headers: { Accept: 'application/json' } });
    const d = await r.json();
    return (d || []).map(x => {
      const parts = (x.display_name || '').split(',').map(s => s.trim());
      return { lat: parseFloat(x.lat), lng: parseFloat(x.lon), label: parts.slice(0, 2).join(', '), sub: parts.slice(2, 4).join(', ') };
    });
  } catch { return []; }
};

const nominatimGeocode = async (term) => {
  const lookup = async (q, extra) => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(q)}${extra}`, { headers: { Accept: 'application/json' } });
      const d = await r.json();
      if (d && d[0]) return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), label: (d[0].display_name || term).split(',').slice(0, 2).join(', ') };
    } catch { /* ignore */ }
    return null;
  };
  return (await lookup(term, `&viewbox=${NI_VIEWBOX}&bounded=1`))
      || (await lookup(`${term}, Northern Ireland`, `&viewbox=${NI_VIEWBOX}&bounded=1`))
      || (await lookup(`${term}, Northern Ireland`, ''))
      || (await lookup(term, ''));
};

// ── Public API ────────────────────────────────────────────────────────────────

// Autocomplete predictions for streets / postcodes / venues (new Places API).
export const suggestPlaces = async (q) => {
  const term = (q || '').trim();
  if (term.length < 3) return [];
  if (GOOGLE_MAPS_KEY) {
    try {
      const { AutocompleteSuggestion, AutocompleteSessionToken } = await placesLib();
      if (AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
        const sessionToken = new AutocompleteSessionToken();
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: term,
          includedRegionCodes: ['gb'],
          locationBias: NI_BIAS,
          sessionToken,
        });
        const out = (suggestions || []).map(s => {
          const p = s.placePrediction;
          if (!p) return null;
          return {
            label: p.mainText?.text || p.text?.text || '',
            sub: p.secondaryText?.text || '',
            placeId: p.placeId,
          };
        }).filter(x => x && x.label);
        if (out.length) { setDiag(''); return out; }
      } else { setDiag('new Places API not on SDK'); }
    } catch (e) { setDiag('places: ' + (e?.message || e)); }
  }
  return nominatimSuggest(term);
};

// Resolve a chosen suggestion to coordinates. Nominatim items already carry
// lat/lng; Google items carry a placeId → fetch its location via the new Place.
export const resolvePlace = async (item) => {
  if (item == null) return null;
  if (item.lat != null && item.lng != null) return { lat: item.lat, lng: item.lng, label: item.label };
  if (item.placeId && GOOGLE_MAPS_KEY) {
    try {
      const { Place } = await placesLib();
      if (Place) {
        const place = new Place({ id: item.placeId });
        await place.fetchFields({ fields: ['location', 'formattedAddress'] });
        const loc = place.location;
        if (loc) return { lat: loc.lat(), lng: loc.lng(), label: item.label };
      }
    } catch { /* ignore */ }
  }
  return null;
};

// Free-text geocode (used when the user presses Enter without picking, and for
// the debounced auto-preview). The classic Geocoder is still available to new
// customers, so this keeps working where autocomplete needs the new API.
export const geocodeText = async (q) => {
  const term = (q || '').trim();
  if (!term) return null;
  if (GOOGLE_MAPS_KEY) {
    try {
      const { Geocoder } = await geocodingLib();
      if (Geocoder) {
        const geocoder = new Geocoder();
        const { results } = await geocoder.geocode({ address: term, componentRestrictions: { country: 'GB' } });
        if (results && results[0]) {
          setDiag('');
          const l = results[0].geometry.location;
          return { lat: l.lat(), lng: l.lng(), label: (results[0].formatted_address || term).split(',').slice(0, 2).join(', ') };
        }
      }
    } catch (e) { setDiag('geocode: ' + (e?.message || e)); }
  }
  return nominatimGeocode(term);
};
