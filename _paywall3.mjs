import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const sel = '.fixed.inset-0.z-\\[200\\]';
async function open(p) {
  await p.goto('http://localhost:4174/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const skip = p.getByText('Browse without an account').first();
  if (await skip.count()) await skip.click().catch(()=>{});
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: /★ Premium/ }).first().click();
  await p.waitForTimeout(700);
}
for (const h of [852, 740, 700, 620, 560]) {
  const p = await b.newPage({ viewport: { width: 393, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await open(p);
  const r = await p.evaluate((s) => {
    const wrap = document.querySelector(s), panel = wrap?.firstElementChild;
    const x = wrap?.querySelector('[aria-label="Close"]');
    const pr = panel.getBoundingClientRect(), xr = x.getBoundingClientRect();
    return { panelH: Math.round(pr.height), scrollable: panel.scrollHeight > panel.clientHeight + 1,
             xTop: Math.round(xr.top), xOnScreen: xr.top >= 0 && xr.bottom <= window.innerHeight };
  }, sel);
  // scroll to the very bottom, then re-check the X is STILL reachable (sticky)
  await p.evaluate((s)=>{ const pn=document.querySelector(s).firstElementChild; pn.scrollTop = pn.scrollHeight; }, sel);
  await p.waitForTimeout(300);
  const after = await p.evaluate((s) => {
    const xr = document.querySelector(s).querySelector('[aria-label="Close"]').getBoundingClientRect();
    return xr.top >= 0 && xr.bottom <= window.innerHeight;
  }, sel);
  console.log(`vh ${String(h).padStart(3)} -> panel ${r.panelH}px  scrollable:${String(r.scrollable).padEnd(5)}  X at y=${String(r.xTop).padStart(4)} onScreen:${r.xOnScreen}  onScreen after scrolling to bottom:${after}`);
  if (h === 700) await p.screenshot({ path: '/tmp/claude-0/-home-user-Parking-finder-/cdb54f7c-ceeb-5fe9-90e7-242b381af3f9/scratchpad/paywall-after.png' });
  await p.close();
}
// escape routes
const p = await b.newPage({ viewport: { width: 393, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await open(p);
await p.mouse.click(5, 350); await p.waitForTimeout(400);
console.log('closes on backdrop tap:', await p.locator(sel).count() === 0);
await open(p);
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
console.log('closes on Escape      :', await p.locator(sel).count() === 0);
await open(p);
await p.locator(sel).getByLabel('Close').click(); await p.waitForTimeout(400);
console.log('closes on X           :', await p.locator(sel).count() === 0);
// and the panel itself must NOT close when you tap inside it
await open(p);
await p.getByText('Hidden gems', { exact: false }).first().click().catch(()=>{});
await p.waitForTimeout(300);
console.log('stays open on inside tap:', await p.locator(sel).count() > 0);
await b.close();
