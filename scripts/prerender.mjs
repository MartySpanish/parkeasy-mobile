// Post-build pre-render: inject real, crawlable SEO content into dist/index.html.
// The app is a client-rendered SPA, so without this Google sees an empty <div id="root">.
// React's createRoot() replaces #root on mount, so users still get the live app —
// but crawlers (and first paint) get genuine content + internal links to every area page.
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const distHtml = 'dist/index.html';
let htmlDoc = readFileSync(distHtml, 'utf8');

let links = '';
try {
  const files = readdirSync('dist/area').filter(f => f.endsWith('.html')).sort();
  links = files.map(f => {
    const c = readFileSync(`dist/area/${f}`, 'utf8');
    const m = c.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const name = (m ? m[1] : f.replace('.html','')).trim();
    return `<li><a href="/area/${f}">${name}</a></li>`;
  }).join('');
} catch {}

const seo = `<div id="seo-prerender" style="max-width:680px;margin:0 auto;padding:48px 22px;color:#EAF1F8;font-family:Manrope,system-ui,sans-serif;background:linear-gradient(180deg,#0d1626,#0a111e);min-height:100vh">
<h1 style="font-family:Sora,sans-serif;font-size:32px;font-weight:800;letter-spacing:-.5px">Find parking in Northern Ireland</h1>
<p style="color:rgba(234,241,248,.72);font-size:16px;line-height:1.6;margin-top:12px">ParkEasy is a free, community-powered parking finder for Belfast, Derry~Londonderry, Lisburn, Newry, Bangor and towns right across Northern Ireland. Search any street, postcode or place and get the nearest car parks, on-street bays, free spots and hidden gems — sorted by distance, with walk times and prices. No account needed.</p>
<h2 style="font-family:Sora,sans-serif;font-size:20px;margin-top:28px">How it works</h2>
<ul style="color:rgba(234,241,248,.72);line-height:1.8;padding-left:20px">
<li>Search a destination — see the closest parking first</li>
<li>Free, hidden-gem and official car parks, confirmed by local drivers</li>
<li>Tap a spot for prices, walk time and live directions</li>
<li>Rent a private driveway, or add a spot you know</li>
</ul>
<h2 style="font-family:Sora,sans-serif;font-size:20px;margin-top:28px">Parking by town</h2>
<ul style="color:#5BE7DA;line-height:1.9;padding-left:20px">${links}</ul>
<p style="color:rgba(234,241,248,.5);margin-top:28px;font-size:14px">Loading the live map… If it doesn't appear, enable JavaScript or visit <a href="https://parkeasy.uk/" style="color:#5BE7DA">parkeasy.uk</a>.</p>
</div>`;

if (htmlDoc.includes('<div id="root"></div>')) {
  htmlDoc = htmlDoc.replace('<div id="root"></div>', `<div id="root">${seo}</div>`);
  writeFileSync(distHtml, htmlDoc);
  console.log('prerender: injected SEO content (' + (links.match(/<li>/g)||[]).length + ' area links)');
} else {
  console.log('prerender: #root placeholder not found, skipped');
}
