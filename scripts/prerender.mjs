// Post-build pre-render: inject real, crawlable SEO content into dist/index.html.
// The app is a client-rendered SPA, so without this Google sees an empty <div id="root">.
// React's createRoot() replaces #root on mount, so users still get the live app —
// but crawlers (and first paint) get genuine content + internal links to every area page.
//
// Town links are GROUPED rather than dumped in one flat list of thirty. A flat
// list is equally crawlable but tells a reader nothing about which places
// matter, and it's the first thing a human sees if JavaScript is slow or off.
// Every link is a plain <a> in the HTML — nothing here depends on JavaScript,
// which is the whole point of the file.
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const distHtml = 'dist/index.html';
let htmlDoc = readFileSync(distHtml, 'utf8');

// Cities we want surfaced first: the ones people actually search for.
const POPULAR = ['belfast', 'derry', 'lisburn', 'newry', 'bangor', 'ballymena', 'coleraine', 'omagh'];
// Belfast neighbourhoods and venues, as opposed to separate towns.
const BELFAST_AREAS = ['botanic', 'cathedral-quarter', 'city-hospital', 'qub', 'sse-arena', 'titanic-quarter'];

let areas = [];
try {
  areas = readdirSync('dist/area').filter(f => f.endsWith('.html')).sort().map(f => {
    const c = readFileSync(`dist/area/${f}`, 'utf8');
    const m = c.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    return { slug: f.replace('.html', ''), file: f, name: (m ? m[1] : f.replace('.html', '')).trim() };
  });
} catch { /* no area pages built yet */ }

const linkList = (items) => items.map(a =>
  `<li><a href="/area/${a.file}">${a.name}</a></li>`).join('');

const popular = areas.filter(a => POPULAR.includes(a.slug))
  .sort((a, b) => POPULAR.indexOf(a.slug) - POPULAR.indexOf(b.slug));
const belfast = areas.filter(a => BELFAST_AREAS.includes(a.slug));
const others  = areas.filter(a => !POPULAR.includes(a.slug) && !BELFAST_AREAS.includes(a.slug));

const ulStyle  = 'color:#5BE7DA;line-height:1.9;padding-left:20px;columns:2;column-gap:24px;list-style:none;margin:0';
const h3Style  = 'font-family:Sora,sans-serif;font-size:15px;margin:20px 0 6px;color:#EAF1F8';

const townNav = [
  popular.length ? `<h3 style="${h3Style}">Popular locations</h3><ul style="${ulStyle}">${linkList(popular)}</ul>` : '',
  belfast.length ? `<h3 style="${h3Style}">Belfast areas</h3><ul style="${ulStyle}">${linkList(belfast)}</ul>` : '',
  others.length  ? `<h3 style="${h3Style}">Other towns</h3><ul style="${ulStyle}">${linkList(others)}</ul>`  : '',
].join('');

const seo = `<div id="seo-prerender" style="max-width:760px;margin:0 auto;padding:48px 22px;color:#EAF1F8;font-family:Manrope,system-ui,sans-serif;background:linear-gradient(180deg,#0d1626,#0a111e);min-height:100vh">
<h1 style="font-family:Sora,sans-serif;font-size:32px;font-weight:800;letter-spacing:-.5px;line-height:1.15">Find parking across Northern Ireland</h1>
<p style="color:rgba(234,241,248,.72);font-size:16px;line-height:1.6;margin-top:12px">Compare nearby car parks, street parking, free spots and local parking tips. ParkEasy is a free, community-powered parking finder for Belfast, Derry~Londonderry, Lisburn, Newry, Bangor and towns right across Northern Ireland. Search any street, postcode, landmark or town and get the nearest parking sorted by distance, with walk times and prices. No account needed.</p>
<h2 style="font-family:Sora,sans-serif;font-size:20px;margin-top:28px">How it works</h2>
<ul style="color:rgba(234,241,248,.72);line-height:1.8;padding-left:20px">
<li>Search a destination — see the closest parking first</li>
<li>Free, hidden-gem and official car parks, confirmed by local drivers</li>
<li>Tap a spot for prices, walk time and directions</li>
<li>Rent a private driveway, or add a spot you know</li>
</ul>
<h2 style="font-family:Sora,sans-serif;font-size:20px;margin-top:28px">Parking by town</h2>
${townNav}
<h2 style="font-family:Sora,sans-serif;font-size:20px;margin-top:28px">Community-powered, not corporate</h2>
<p style="color:rgba(234,241,248,.72);font-size:15px;line-height:1.6;margin-top:8px">Listings cover official council and private car parks, on-street bays, free spots and local recommendations people have shared. Prices, hours and restrictions change, and we don't have live availability — always check the signs and local restrictions when you arrive.</p>
<p style="color:rgba(234,241,248,.5);margin-top:28px;font-size:14px">Loading the live map… If it doesn't appear, enable JavaScript or visit <a href="https://parkeasy.uk/" style="color:#5BE7DA">parkeasy.uk</a>.</p>
</div>`;

if (htmlDoc.includes('<div id="root"></div>')) {
  htmlDoc = htmlDoc.replace('<div id="root"></div>', `<div id="root">${seo}</div>`);
  writeFileSync(distHtml, htmlDoc);
  console.log(`prerender: injected SEO content (${areas.length} area links — `
    + `${popular.length} popular, ${belfast.length} Belfast, ${others.length} other)`);
} else {
  console.warn('prerender: <div id="root"></div> not found — SEO block NOT injected');
  process.exitCode = 1;
}
