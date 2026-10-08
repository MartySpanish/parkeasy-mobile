// The base map's <TileLayer>, and the only place that knows the provider can
// change after mount.
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
import { TileLayer } from 'react-leaflet';
import { useEffect, useState } from 'react';
import { tileLayerProps, onTilesChanged } from '../../mapTiles';

export default function BaseTileLayer() {
  // A counter rather than the props themselves: tileLayerProps() also depends
  // on the theme, which changes without any notification, so the props are read
  // fresh on every render instead of being cached in state and going stale.
  const [, bump] = useState(0);
  useEffect(() => onTilesChanged(() => bump(n => n + 1)), []);
  return <TileLayer {...tileLayerProps()}/>;
}
