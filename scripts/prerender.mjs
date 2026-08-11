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
import { BOOKABLE_SPACES, gbp } from '../src/data/bookableSpaces.js';

// Cheapest price anyone can ACTUALLY pay today. Derived, never typed: the
// first draft of this line advertised "from £17.25", which is Belfast Royal
// Academy's rate — and BRA is still pending_approval, so nobody could have
// booked at that price. Advertising a price that cannot be paid is worse than
// advertising none.
const FROM_PRICE = BOOKABLE_SPACES.length
  ? gbp(Math.min(...BOOKABLE_SPACES.map(s => s.allInPence)))
  : null;

// The page has to sell whichever product actually exists today.
//
// With bookable inventory it leads with booking, because a held space is the
// strongest thing we offer. With none — which is where we are with Davitt Park
// and the Academy off sale — leading with "book a guaranteed space" points
// every ad and QR code at an empty shelf, which converts worse than saying
// nothing. So it falls back to the product that IS selling: 9 of the 10 people
// who have ever paid us bought Premium, not a booking.
//
// Counts are the app's own, from src/App.jsx + the spot modules:
//   node -e "…" → TOTAL 741 | hidden gems 88 | EV 207
// Re-run that if the datasets change. Understate rather than overstate: an
// inflated number is the one mistake a stranger can catch you out on.
const NETWORK = { spots: 741, gems: 88, ev: 207 };

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
<p style="color:rgba(234,241,248,.72);font-size:16px;line-height:1.6;margin-top:12px">${FROM_PRICE
  ? `<strong style="color:#EAF1F8">Book and pay for a guaranteed parking space in Belfast from ${FROM_PRICE} a day</strong> &mdash; reserved in advance at school, church and GAA club car parks, and held for you when you arrive. ParkEasy also lists ${NETWORK.spots} free spots, on-street bays and local parking tips right across Northern Ireland.`
  : `<strong style="color:#EAF1F8">${NETWORK.spots} parking spots across Northern Ireland &mdash; including ${NETWORK.gems} hidden gems the locals use and ${NETWORK.ev} EV chargers.</strong> Know where you're parking, what it costs and what the restrictions are before you leave the house, in Belfast, Derry~Londonderry, Lisburn, Newry, Bangor and towns right across Northern Ireland.`}</p>
<p style="margin:18px 0 0">${FROM_PRICE
  ? '<a href="https://parkeasy.uk/?tab=spaces" style="display:inline-block;background:linear-gradient(135deg,#54E6D8,#2ED3C6);color:#06231F;font-weight:800;padding:13px 22px;border-radius:12px;text-decoration:none;font-size:16px">Book a space &rarr;</a>'
  : '<a href="https://parkeasy.uk/" style="display:inline-block;background:linear-gradient(135deg,#54E6D8,#2ED3C6);color:#06231F;font-weight:800;padding:13px 22px;border-radius:12px;text-decoration:none;font-size:16px">Find parking near you &rarr;</a>'}</p>
<h2 style="font-family:Sora,sans-serif;font-size:20px;margin-top:28px">How it works</h2>
<ul style="color:rgba(234,241,248,.72);line-height:1.8;padding-left:20px">
${FROM_PRICE ? '<li><strong style="color:#EAF1F8">Book a space in advance</strong> and it is held for you &mdash; paid by card, no meter, no circling</li>' : ''}
<li>Search any destination for the closest free, hidden-gem and official car parks</li>
<li><strong style="color:#EAF1F8">${NETWORK.gems} hidden gems</strong> &mdash; the free, legal kerbside spots locals use near the places everyone drives to</li>
<li>Prices are all-in: what you see is what you pay</li>
<li>Rent out your own driveway or car park and keep 85% of every booking</li>
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
