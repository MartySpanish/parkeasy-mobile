import { chromium } from 'playwright';
const D='/tmp/claude-0/-home-user-Parking-finder-/cdb54f7c-ceeb-5fe9-90e7-242b381af3f9/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for (const w of [320, 360, 390, 430, 480, 560, 768, 1280]) {
  const p=await b.newPage({viewport:{width:w,height:800},deviceScaleFactor:2});
  await p.goto('http://localhost:4442/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2600);
  let g=p.locator('button:has-text("Browse without an account")');
  if(await g.count()){await g.first().click();await p.waitForTimeout(900);}
  g=p.locator('button:has-text("Accept all")'); if(await g.count()){await g.first().click();await p.waitForTimeout(400);}
  const r=await p.evaluate(()=>{
    const hdr=document.querySelector('header');
    const brand=[...hdr.querySelectorAll('p')].find(e=>e.innerText.trim().startsWith('ParkEasy'));
    const btns=[...hdr.querySelectorAll('button')]; const bb=brand.getBoundingClientRect();
    const clash=btns.filter(x=>{const r2=x.getBoundingClientRect();
      return !(bb.right<=r2.left||bb.left>=r2.right||bb.bottom<=r2.top||bb.top>=r2.bottom);});
    return {trunc:brand.scrollWidth>brand.clientWidth+1, overlaps:clash.length,
            hscroll:document.documentElement.scrollWidth>window.innerWidth};
  });
  const ok = !r.trunc && !r.overlaps && !r.hscroll;
  console.log(`${String(w).padStart(4)}px  ${ok?'OK  ':'FAIL'}  truncated=${r.trunc} overlaps=${r.overlaps} h-scroll=${r.hscroll}`);
  if ([320,768].includes(w)) await p.locator('header').screenshot({path:`${D}/hdr3-${w}.png`});
  await p.close();
}
await b.close();
