// The globe from /globe, shrunk to a card and put in the app.
//
// WHY IT IS LAZY, AND WHY THAT IS NOT OPTIONAL. The standalone page at /globe
// loads 273 KB of d3 and 105 KB of world outline. Putting that in the app
// bundle would add a third to a 1.3 MB download that a driver on mobile data
// waits through before they can search for a parking space — to show a
// decoration. So:
//
//   * only d3-geo is imported (~25 KB), not all of d3. The page uses five
//     functions and every one of them lives in d3-geo.
//   * this file is React.lazy()'d by its parent, so none of it is in the main
//     chunk. Vite still modulepreloads the 27 KB chunk, so that part IS fetched
//     on load — measured, not assumed. It is the cheap part.
//   * the 180 KB of world outline, Ireland and spaces is not fetched until the
//     card is actually scrolled to. Somebody who searches and leaves never pays
//     for it at all, which is the saving that matters.
//
// AND WHY IT STOPS MOVING. A requestAnimationFrame loop that never sleeps is a
// battery drain and, on a long list, a source of scroll jank. This one stops
// whenever the card is off screen, and never starts at all for a visitor whose
// system asks for reduced motion — they get the same globe, drawn once, still.
import { useEffect, useRef, useState } from 'react';
import { geoOrthographic, geoPath, geoGraticule10, geoDistance } from 'd3-geo';
import { merge } from 'topojson-client';

// Brand values, same as src/theme/tokens.js and the /globe page.
const C = {
  sea:     'rgba(46,211,198,0.05)',
  rim:     'rgba(46,211,198,0.55)',
  grid:    'rgba(255,255,255,0.055)',
  land:    '#1b2942',
  landEdge:'rgba(255,255,255,0.07)',
  irl:     'rgba(255,255,255,0.06)',
  ni:      'rgba(46,211,198,0.30)',
  niEdge:  '#5BE7DA',
  dot:     'rgba(91,231,218,0.85)',
  gem:     '#C9A7FF',
};

/** Belfast, and the tilt that keeps it facing the viewer at rest. */
const BELFAST = [-5.93, 54.6];

export default function CoverageGlobe({ spaces, gems, towns }) {
  const wrapRef   = useRef(null);
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let alive = true;
    let raf = 0;
    let visible = false;
    let data = null;                       // { land, ni, dots }
    let started = false;

    const reduced = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── Fetch, once, and only when it can actually be seen ──────────────────
    const load = async () => {
      if (started) return;
      started = true;
      try {
        const [world, ni, places] = await Promise.all([
          fetch('/globe/countries-110m.json').then(r => r.json()),
          fetch('/globe/ni-ireland.json').then(r => r.json()),
          // Best-effort: the dots are the nicest part but the globe still reads
          // without them, so a failure here must not lose the whole card.
          fetch('/globe/places.json').then(r => r.json()).catch(() => null),
        ]);
        if (!alive) return;
        // The two files have different shapes, and getting this wrong is what
        // made the card silently delete itself the first time.
        //   countries-110m.json IS topojson, and is merged rather than
        //     featured: merge drops the internal country borders and leaves one
        //     clean landmass, which is what reads well at this size.
        //   ni-ireland.json is NOT topojson. It is a plain object of two ready
        //     GeoJSON Features, { ni, ireland }, and decoding it throws.
        // Both match how /globe consumes them, so the two stay in step.
        data = {
          land:    merge(world, world.objects.countries.geometries),
          ireland: ni.ireland,
          ni:      ni.ni,
          dots: (places?.spaces || []).map(s => ({ c: s.c, gem: s.t === 'gem' })),
        };
        setReady(true);
        draw(0);
        if (!reduced) raf = requestAnimationFrame(spin);
      } catch {
        if (alive) setFailed(true);        // the card removes itself — see below
      }
    };

    // ── Drawing ─────────────────────────────────────────────────────────────
    let rotation = -BELFAST[0];            // longitude offset, degrees

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || !data) return;
      const cssW = wrap.clientWidth;
      const cssH = Math.round(cssW * 0.62);
      const dpr  = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== cssW * dpr) {
        canvas.width  = cssW * dpr;
        canvas.height = cssH * dpr;
        canvas.style.width  = cssW + 'px';
        canvas.style.height = cssH + 'px';
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const r = Math.min(cssW, cssH) / 2 - 6;
      const projection = geoOrthographic()
        .scale(r)
        .translate([cssW / 2, cssH / 2])
        // Tilt so Northern Ireland sits in the upper third rather than dead
        // centre — the same framing the /globe page uses.
        .rotate([rotation, -32, 0])
        .clipAngle(90);
      const path = geoPath(projection, ctx);

      ctx.beginPath(); path({ type: 'Sphere' });
      ctx.fillStyle = C.sea; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = C.rim; ctx.stroke();

      ctx.beginPath(); path(geoGraticule10());
      ctx.lineWidth = 0.5; ctx.strokeStyle = C.grid; ctx.stroke();

      ctx.beginPath(); path(data.land);
      ctx.fillStyle = C.land; ctx.fill();
      ctx.lineWidth = 0.5; ctx.strokeStyle = C.landEdge; ctx.stroke();

      // Ireland underneath, so Northern Ireland reads as part of an island
      // rather than a shape floating in the sea.
      ctx.beginPath(); path(data.ireland);
      ctx.fillStyle = C.irl; ctx.fill();

      ctx.beginPath(); path(data.ni);
      ctx.fillStyle = C.ni; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = C.niEdge; ctx.stroke();

      // The spaces. Skipped entirely when they are on the far side of the
      // sphere, where they would otherwise smear across the limb.
      for (const d of data.dots) {
        const p = projection(d.c);
        if (!p) continue;                  // clipped: behind the globe
        ctx.beginPath();
        ctx.arc(p[0], p[1], d.gem ? 1.5 : 1.1, 0, Math.PI * 2);
        ctx.fillStyle = d.gem ? C.gem : C.dot;
        ctx.fill();
      }

      // BELFAST, RINGED AND NAMED — the thing that turns a stock spinning Earth
      // into this product's globe. Without it the headline says "Northern
      // Ireland" over an unlabelled speck and the reader has to be told where
      // to look.
      //
      // geoDistance, not the projection alone: an orthographic projection still
      // returns coordinates for a point just over the horizon, so the label
      // would ghost through the planet as it rotates away. Anything beyond a
      // radian from the centre of the visible face is behind the world.
      const centre = [-rotation, 32];
      if (geoDistance(BELFAST, centre) < Math.PI / 2.2) {
        const b = projection(BELFAST);
        if (b) {
          ctx.beginPath();
          ctx.arc(b[0], b[1], 9, 0, Math.PI * 2);
          ctx.lineWidth = 1.2; ctx.strokeStyle = C.niEdge; ctx.stroke();
          ctx.font = '700 9px Manrope, system-ui, sans-serif';
          ctx.fillStyle = C.niEdge;
          ctx.textBaseline = 'middle';
          ctx.fillText('BELFAST', b[0] + 13, b[1]);
        }
      }
    };

    const spin = () => {
      if (!alive) return;
      if (visible) { rotation += 0.06; draw(); }
      raf = requestAnimationFrame(spin);
    };

    // ── Only work while on screen ───────────────────────────────────────────
    const io = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) load();
    }, { rootMargin: '200px' });
    io.observe(wrap);

    const onResize = () => draw();
    window.addEventListener('resize', onResize);

    return () => {
      alive = false;
      io.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // A globe that cannot load is not worth a broken box on the homepage. The
  // whole section disappears and the page closes up behind it.
  if (failed) return null;

  const stat = (n, label) => (
    <span className="flex flex-col">
      <span className="font-display font-extrabold text-[17px] text-[#EAF1F8] leading-none">{n}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[rgba(234,241,248,0.45)] mt-1">{label}</span>
    </span>
  );

  return (
    <section className="px-4 pt-6" aria-labelledby="pe-coverage">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#5BE7DA]">Coverage</p>
      <h2 id="pe-coverage" className="font-display font-extrabold text-[19px] text-[#EAF1F8] leading-tight mt-1">
        Every space Northern Ireland already has
      </h2>
      <div ref={wrapRef}
        className="mt-3 rounded-2xl overflow-hidden relative"
        style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.10)'}}>
        {/* aria-hidden: it is decoration. The numbers underneath carry the
            meaning, and they are real text. */}
        <canvas ref={canvasRef} aria-hidden="true"
          className="block w-full transition-opacity duration-500"
          style={{opacity: ready ? 1 : 0}}/>
        {!ready && <div style={{paddingTop:'62%'}}/>}
      </div>
      <div className="flex items-start gap-6 mt-3">
        {stat(spaces, 'Spaces mapped')}
        {stat(gems,   'Hidden gems')}
        {stat(towns,  'Towns covered')}
      </div>
      <a href="/globe"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#5BE7DA] mt-3 px-3 py-2 -ml-3 rounded-full active:scale-95 transition">
        Explore the map &rarr;
      </a>
    </section>
  );
}
