import { chromium } from "playwright";
const b = await chromium.launch(); 
for (const [n,w,h] of [["desk",1280,800],["mob",390,844]]) {
  const p = await b.newPage({ viewport:{width:w,height:h} });
  p.on("console", m => console.log(n, m.text()));
  await p.goto("http://localhost:3000"); await p.waitForTimeout(2500);
  await p.screenshot({ path: `${n}.png` });
  try { await p.click("[data-authmode=signup]", { timeout: 3000 }); await p.waitForTimeout(300); await p.screenshot({ path: `${n}-signup.png` }); console.log(n, "pressed:", await p.getAttribute("[data-authmode=signup]","aria-pressed")); } catch(e){ console.log(n, "click fail", e.message.split("\n")[0]); }
}
await b.close();
