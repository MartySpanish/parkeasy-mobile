// Geocoding + address autocomplete.
// Prefers Google (Places Autocomplete + Geocoder via the JS SDK, which is
// CORS-safe in the browser — unlike Google's REST geocoder) when a Maps key is
// configured. Falls back to free OpenStreetMap Nominatim otherwise.

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
export const hasGoogle = !!GOOGLE_MAPS_KEY;

// Northern Ireland bias box (lng/lat extents).
const NI_VIEWBOX = '-8.3,55.45,-5.3,54.0';

let googlePromise = null;
const loadGoogle = () => {
  if (!GOOGLE_MAPS_KEY) return Promise.reject(new Error('no key'));
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (googlePromise) return googlePromise;
  googlePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places&loading=async`;
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error('google maps failed to load'));
    document.head.appendChild(s);
  });
  return googlePromise;
};

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
  // Try the term as typed (NI-bounded), then with an explicit region hint to
  // improve the hit rate for street addresses, then a UK-wide fallback.
  return (await lookup(term, `&viewbox=${NI_VIEWBOX}&bounded=1`))
      || (await lookup(`${term}, Northern Ireland`, `&viewbox=${NI_VIEWBOX}&bounded=1`))
      || (await lookup(`${term}, Northern Ireland`, ''))
      || (await lookup(term, ''));
};

// ── Public API ────────────────────────────────────────────────────────────────

// Autocomplete predictions for streets / postcodes / venues.
export const suggestPlaces = async (q) => {
  const term = (q || '').trim();
  if (term.length < 3) return [];
  if (GOOGLE_MAPS_KEY) {
    try {
      const g = await loadGoogle();
      const svc = new g.maps.places.AutocompleteService();
      const bounds = new g.maps.LatLngBounds(new g.maps.LatLng(54.0, -8.3), new g.maps.LatLng(55.45, -5.3));
      const preds = await new Promise((resolve) => {
        svc.getPlacePredictions(
          { input: term, componentRestrictions: { country: 'gb' }, locationBias: bounds },
          (res) => resolve(res || [])
        );
      });
      if (preds.length) {
        return preds.map(p => ({
          label: p.structured_formatting?.main_text || p.description,
          sub: p.structured_formatting?.secondary_text || '',
          placeId: p.place_id,
        }));
      }
    } catch { /* fall back to Nominatim */ }
  }
  return nominatimSuggest(term);
};

// Resolve a chosen suggestion (Nominatim items carry lat/lng; Google items
// carry a placeId that we geocode to coordinates).
export const resolvePlace = async (item) => {
  if (item == null) return null;
  if (item.lat != null && item.lng != null) return { lat: item.lat, lng: item.lng, label: item.label };
  if (item.placeId && GOOGLE_MAPS_KEY) {
    try {
      const g = await loadGoogle();
      const geocoder = new g.maps.Geocoder();
      const r = await new Promise((resolve) => geocoder.geocode({ placeId: item.placeId }, (res, status) => resolve(status === 'OK' ? res : [])));
      if (r[0]) { const l = r[0].geometry.location; return { lat: l.lat(), lng: l.lng(), label: item.label }; }
    } catch { /* ignore */ }
  }
  return null;
};

// Free-text geocode (used when the user presses Enter without picking).
export const geocodeText = async (q) => {
  const term = (q || '').trim();
  if (!term) return null;
  if (GOOGLE_MAPS_KEY) {
    try {
      const g = await loadGoogle();
      const geocoder = new g.maps.Geocoder();
      const r = await new Promise((resolve) => geocoder.geocode({ address: term, componentRestrictions: { country: 'GB' } }, (res, status) => resolve(status === 'OK' ? res : [])));
      if (r[0]) { const l = r[0].geometry.location; return { lat: l.lat(), lng: l.lng(), label: (r[0].formatted_address || term).split(',').slice(0, 2).join(', ') }; }
    } catch { /* fall back to Nominatim */ }
  }
  return nominatimGeocode(term);
};
