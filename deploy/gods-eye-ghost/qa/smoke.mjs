// Keyless baseline smoke test - lives OUTSIDE the pristine donor checkout.
import puppeteer from 'file:///G:/tommy/donors/gods-eye-ghost/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const URL = 'http://localhost:4173';
const OUT = 'G:/tommy/deploy/gods-eye-ghost/qa';

const browser = await puppeteer.launch({
  headless: 'shell' === 'never' ? false : true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist','--enable-webgl','--no-sandbox'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const errors = [], pageErrors = [], failedReq = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0,300)); });
page.on('pageerror', e => pageErrors.push(String(e).slice(0,300)));
page.on('requestfailed', r => failedReq.push(`${r.failure()?.errorText} ${r.url().slice(0,120)}`));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });

// WebGL2 capability in this browser session
const webgl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return { webgl2: false };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { webgl2: true,
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
});

// let live feeds have a chance to arrive
await new Promise(r => setTimeout(r, 45000));

const state = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  let painted = false;
  if (canvas) { try { painted = canvas.width > 0 && canvas.height > 0; } catch {} }
  const txt = document.body.innerText || '';
  const grab = (re) => { const m = txt.match(re); return m ? m[0] : null; };
  return {
    title: document.title,
    canvas: canvas ? { w: canvas.width, h: canvas.height, painted } : null,
    activeStack: document.querySelector('[data-active-stack]')?.getAttribute('data-active-stack')
                 ?? document.querySelector('.map-source-tile[aria-pressed="true"]')?.dataset?.stack ?? null,
    unavailableLabels: [...document.querySelectorAll('[aria-disabled="true"][aria-label]')]
                        .map(e => e.getAttribute('aria-label')).slice(0,12),
    bodyMentions: {
      firms: /FIRMS/i.test(txt), simulated: /SIMULAT/i.test(txt),
      ais: /AIS|VESSEL/i.test(txt), quake: /QUAKE|SEISM|USGS/i.test(txt),
      sat: /SATELLITE|ORBIT/i.test(txt), traffic: /TRAFFIC/i.test(txt),
    },
  };
});

console.log(JSON.stringify({ webgl, state,
  consoleErrors: errors.length, pageErrors: pageErrors.length,
  sampleConsoleErrors: errors.slice(0,15),
  samplePageErrors: pageErrors.slice(0,10),
  failedRequests: failedReq.length, sampleFailedRequests: failedReq.slice(0,20),
}, null, 2));
try { await page.screenshot({ path: `${OUT}/keyless-globe.png` }); console.log('screenshot: ok'); }
catch (e) { console.log('screenshot: FAILED ' + e.message.slice(0,120)); }

// non-fatal check on a refresh
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
await new Promise(r => setTimeout(r, 20000));
try { await page.screenshot({ path: `${OUT}/keyless-globe-after-reload.png` }); } catch (e) { console.log('reload screenshot failed'); }

console.log('errorsAfterReload: console=' + errors.length + ' page=' + pageErrors.length);
await browser.close();
