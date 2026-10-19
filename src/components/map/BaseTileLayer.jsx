// The base map's <TileLayer>, and the only place that knows the provider can
// change after mount — and, since the box a map is drawn in can change after
// mount too, the only place that watches for that.
//
// WHY THIS COMPONENT EXISTS. The Google session token arrives asynchronously,
// a few hundred milliseconds after the first paint. Before this, every map
// rendered `<TileLayer {...tileLayerProps()}/>` directly: tileLayerProps()
// reads a module variable, React never learned it had changed, and so the map
// kept the OpenStreetMap url it mounted with. react-leaflet 4 does call
// layer.setUrl() when the url prop changes — the missing piece was only ever a
// re-render.
//
// So a first-time visitor saw an OSM map for their whole visit, and only a
// second page load came up on Google, because by then the token was in
// localStorage and could be read synchronously. That is the wrong first
// impression of the app, and five separate call sites each had to get the
// subscription right for it not to happen. Now one does.
//
// THE SECOND BUG, SAME SHAPE: THE MAP ONLY DREW TILES IN THE MIDDLE. Leaflet
// measures its container exactly once, when the map mounts, and from then on
// it only re-measures on a window resize (that is all `trackResize` watches).
// It never notices the container itself changing size. Here that happens all
// the time: the Nearby map is 250px tall while the "turn on location" prompt
// is showing and 380px once it is dismissed; a map inside a tab or a sheet
// mounts while that panel is still animating in at a narrower width; the spot
// sheet's header map mounts during its slide-up. In every case Leaflet keeps
// drawing for the size it first saw — tiles in a band down the middle, the
// app's dark background either side, and pins that are placed for a map that
// is not the one on screen. The fix Leaflet provides is map.invalidateSize(),
// and the thing that knows when to call it is a ResizeObserver on the map's
// own element. One observer here covers every map, because every map renders
// this component. The first invalidateSize is deferred to the next frame on
// purpose: the observer fires once on attach, before layout has finished, and
// invalidating on that measurement just repeats the original mistake.
import { TileLayer, useMap } from 'react-leaflet';
import { useEffect, useState } from 'react';
import { tileLayerProps, onTilesChanged } from '../../mapTiles';

/** Tell Leaflet whenever the element it draws in changes size. */
export const FitToContainer = () => {
  const map = useMap();
  useEffect(() => {
    if (!map) return undefined;
    const el = map.getContainer();
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // The map may have been removed between the observation and the frame
        // — a tab closing mid-animation does exactly that — and invalidateSize
        // on a removed map throws.
        try { map.invalidateSize({ animate: false }); } catch { /* fine */ }
      });
    };
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(frame); };
  }, [map]);
  return null;
};

export default function BaseTileLayer() {
  // A counter rather than the props themselves: tileLayerProps() also depends
  // on the theme, which changes without any notification, so the props are read
  // fresh on every render instead of being cached in state and going stale.
  const [, bump] = useState(0);
  useEffect(() => onTilesChanged(() => bump(n => n + 1)), []);
  return (
    <>
      <TileLayer {...tileLayerProps()}/>
      <FitToContainer/>
    </>
  );
}
