import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE='https://code-qr.stockcity.ru'; const HOST='code-qr.stockcity.ru'; const PORT=10001;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'chrome-ai-')); const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--no-first-run','--disable-gpu','--no-sandbox','--window-size=1440,1200','about:blank'],{stdio:'ignore'});
let target; for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:'PUT'}); if(r.ok){target=await r.json();break;}}catch{} await sleep(250);}
const ws=new WebSocket(target.webSocketDebuggerUrl); let seq=0; const pending=new Map(); const errors=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);return;} if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description||'').join(' ').slice(0,120));};
await new Promise(r=>{ws.onopen=r;});
const send=(method,params={})=>new Promise(r=>{const id=++seq;pending.set(id,r);ws.send(JSON.stringify({id,method,params}));});
const ev=async(expr)=>(await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true})).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
await send('Network.setCookie',{name:'cq_session',value:process.argv[2],domain:HOST,path:'/',secure:true,httpOnly:true,sameSite:'Lax'});
await send('Page.navigate',{url:BASE+'/app'}); await sleep(2200);
const metrics=JSON.parse(await ev(`(() => {
  const dock=document.querySelector('.ai-dock');
  const btn=document.querySelector('.ai-launcher');
  const robot=document.querySelector('.ai-robot-float');
  const hint=document.querySelector('.ai-hint-bubble');
  const r=btn?btn.getBoundingClientRect():null;
  return JSON.stringify({ w:r?Math.round(r.width):null, h:r?Math.round(r.height):null, right:r?Math.round(innerWidth-r.right):null, bottom:r?Math.round(innerHeight-r.bottom):null,
    text:(btn?btn.textContent:'')?.trim().slice(0,40), robot:Boolean(robot), hint:Boolean(hint), dockVisible: dock?getComputedStyle(dock).display!=='none':false });
})()`));
console.log('desktop metric:', JSON.stringify(metrics));
const checks=[]; const ok=(n,c,x='')=>{checks.push(!!c); console.log(`${c?'PASS':'FAIL'} — ${n}${x?' | '+x:''}`);};
ok('Кнопка круглая (w=h≈56)', metrics.w===metrics.h && metrics.w>=52 && metrics.w<=60, JSON.stringify(metrics));
ok('Нет робота над кнопкой', metrics.robot===false);
ok('Нет всплывающей подсказки', metrics.hint===false);
ok('Кнопка в углу, не растянута по ширине', metrics.right>=8 && metrics.right<=45 && metrics.bottom>=8 && metrics.bottom<=40, JSON.stringify(metrics));
ok('Внутри кнопки нет длинного текста', (metrics.text||'').length<=4, metrics.text);
let overlap = { top: false, tag: '' };
try {
  const raw = await ev(`(() => {
    const btn = document.querySelector('.ai-launcher');
    if (!btn) return '{}';
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return JSON.stringify({ top: el === btn || (btn.contains && btn.contains(el)), tag: el ? el.tagName : '' });
  })()`);
  overlap = JSON.parse(raw || '{}');
} catch { /* treat as not clickable */ }
ok('Кнопка кликабельна (сверху)', overlap.top, JSON.stringify(overlap));
await ev(`(() => { document.querySelector('.ai-launcher')?.click(); return 1; })()`); await sleep(900);
const opened=JSON.parse(await ev(`(() => { const d=document.querySelector('.ai-panel'); const dock=document.querySelector('.ai-dock'); return JSON.stringify({ dialog:Boolean(d), dockHidden: dock?getComputedStyle(dock).display==='none':true }); })()`));
ok('Диалог открывается, кнопка скрывается', opened.dialog===true && opened.dockHidden===true, JSON.stringify(opened));
await ev(`(() => { const b=document.querySelector('.ai-panel button[aria-label="Закрыть"]'); if(b)b.click(); return 1; })()`); await sleep(500);
const closed=await ev(`Boolean(document.querySelector('.ai-panel'))`);
ok('Диалог закрывается', closed===false);
const shot=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync('docs/ai-button-premium.png',Buffer.from(shot.result.data,'base64'));
console.log('screenshot: docs/ai-button-premium.png');
console.log('console errors:', errors.length, JSON.stringify(errors.slice(0,3)));
const failed=checks.filter(x=>!x).length; console.log(`итог: ${checks.length-failed}/${checks.length}`);
ws.close(); chrome.kill(); process.exit(failed?1:0);
