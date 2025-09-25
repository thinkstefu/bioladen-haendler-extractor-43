
import { Actor, Dataset, KeyValueStore, log } from 'apify';
import { chromium, devices } from 'playwright';
import crypto from 'crypto';
import fs from 'fs/promises';

const START_URL = 'https://www.bioladen.de/bio-haendler-suche';
const INPUT_SEL = 'input[name="tx_biohandel_plg[searchplz]"], input[placeholder*="Postleitzahl" i], input[aria-label*="Postleitzahl" i], input[placeholder*="PLZ" i]';
const RADIUS_SEL = 'select[name*="radius" i], select[name*="distance" i], select:has(option:has-text("25"))';
const DETAIL_ANCHOR_SEL = 'a[href*="tx_biohandel_plg"][href*="%5Bbetrieb%5D"], a[href*="tx_biohandel_plg"][href*="[betrieb]"]';

function norm(s) { return (s || '').replace(/[\s\u00A0]+/g, ' ').trim(); }
function sha1(s) { return (crypto.createHash('sha1').update(String(s)).digest('hex')); }

function e164DE(phone) {
  if (!phone) return null;
  let s = String(phone).trim().replace(/^tel:/i, '');
  let keep = s.replace(/[^\d+]/g, '');
  if (keep.startsWith('00')) keep = '+' + keep.slice(2);
  if (!keep.startsWith('+')) {
    if (keep.startsWith('0')) keep = '+49' + keep.slice(1);
    else keep = '+49' + keep;
  }
  const digits = keep.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return keep;
}

async function loadPlzList(useKvPlz, maxCities) {
  if (useKvPlz) {
    try {
      const store = await KeyValueStore.open();
      const buf = await store.getValue('plz_cities.txt', { buffer: true });
      if (buf && buf.length) {
        return buf.toString('utf-8').split(/\r?\n/).map(s => s.replace(/#.*/, '').trim()).filter(Boolean).slice(0, maxCities);
      }
    } catch (e) { log.warning('KV-Load fehlgeschlagen: ' + e.message); }
    log.warning('useKvPlz=true, aber plz_cities.txt nicht im KV gefunden – fallback auf lokale Datei.');
  }
  try {
    const url = new URL('../data/plz_cities.txt', import.meta.url);
    const txt = await fs.readFile(url, 'utf-8');
    return txt.split(/\r?\n/).map(s => s.replace(/#.*/, '').trim()).filter(Boolean).slice(0, maxCities);
  } catch (e) {
    log.error('Konnte data/plz_cities.txt nicht lesen: ' + e.message);
    return ['20095'];
  }
}

async function acceptCookies(page) {
  const texts = ['Akzeptieren','Einverstanden','Zustimmen','Alle akzeptieren','Ich stimme zu','OK'];
  for (const t of texts) {
    try {
      const b = page.locator(`button:has-text("${t}")`).first();
      if (await b.count()) await b.click({ timeout: 1000 }).catch(()=>{});
    } catch (e) {}
  }
  for (const f of page.frames()) {
    for (const t of texts) {
      try {
        const b = f.locator(`button:has-text("${t}")`).first();
        if (await b.count()) await b.click({ timeout: 1000 }).catch(()=>{});
      } catch (e) {}
    }
  }
  try {
    await page.locator('[aria-label*="akzeptieren" i], .cc-allow, .cm-btn, .uc-btn, .cky-btn-accept').first().click({ timeout: 1000 });
  } catch (e) {}
}

async function ensureVisibleAndType(page, selector, value) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'attached', timeout: 15000 });
  try { await loc.scrollIntoViewIfNeeded(); } catch (e) {}
  if (!(await loc.isVisible()).valueOf()) {
    await page.evaluate(({ sel, val }) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('ZIP input not found');
      el.removeAttribute('disabled');
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
      el.style.opacity = '1';
      el.value = String(val);
      ['input','change','keyup'].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));
    }, { sel: selector, val: String(value) });
  } else {
    await loc.fill('');
    await loc.type(String(value), { delay: 25 });
  }
}

async function setRadius(page, radiusKm) {
  try {
    const sel = page.locator(RADIUS_SEL).first();
    if (await sel.count()) {
      const v = String(radiusKm);
      await sel.selectOption({ value: v }).catch(async () => {
        await sel.selectOption({ label: new RegExp(`^\\s*${v}\\s*km\\s*$`, 'i') }).catch(()=>{});
      });
    }
  } catch (e) {}
}

async function submitSearch(page) {
  try {
    await page.evaluate(({ inputSel }) => {
      const el = document.querySelector(inputSel);
      if (!el) throw new Error('ZIP input not found');
      const form = el.form || el.closest('form');
      if (!form) throw new Error('Form not found');
      if (form.requestSubmit) form.requestSubmit(); else form.submit();
    }, { inputSel: INPUT_SEL });
    return true;
  } catch (e) {
    try { await page.keyboard.press('Enter'); return true; } catch (ee) {}
  }
  return false;
}

async function waitForAnyDetailAnchors(page) {
  for (let i=0; i<70; i++) {
    try {
      const c = await page.locator(DETAIL_ANCHOR_SEL).count();
      if (c > 0) return true;
    } catch (e) {}
    for (const f of page.frames()) {
      try {
        const c = await f.locator(DETAIL_ANCHOR_SEL).count();
        if (c > 0) return true;
      } catch (e) {}
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function collectDetailLinks(page) {
  const hrefs = new Set();
  const grab = async (ctx) => {
    const list = await ctx.locator(DETAIL_ANCHOR_SEL).evaluateAll(els => els.map(a => a.href));
    for (const h of list) if (h) hrefs.add(h);
  };
  await grab(page);
  for (const f of page.frames()) { try { await grab(f); } catch (e) {} }
  return Array.from(hrefs);
}

async function extractDetailsFrom(page) {
  const data = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/[\\s\\u00A0]+/g, ' ').trim();

    let phone = null;
    const telEl = document.querySelector('a[href^="tel:"]');
    if (telEl) phone = telEl.getAttribute('href') || telEl.textContent || null;

    let email = null;
    const mailEl = document.querySelector('a[href^="mailto:"]');
    if (mailEl) email = (mailEl.getAttribute('href') || '').replace(/^mailto:/i, '') || null;

    let website = null;
    const links = Array.from(document.querySelectorAll('a[href^="http"]')).map(a => a.href);
    const ext = links.find(href => {
      try {
        const host = (new URL(href)).hostname.toLowerCase();
        if (host.includes('bioladen.de')) return false;
        if (/(facebook|instagram|youtube|x\\.com|twitter)\\.com/.test(host)) return false;
        return true;
      } catch (e) { return false; }
    });
    if (ext) website = ext;

    let addr = '';
    const addrCand = Array.from(document.querySelectorAll('address, .address, .addr, .contact, p'))
      .map(e => norm(e.textContent)).filter(Boolean);
    addr = addrCand.find(x => /\\b\\d{5}\\b/.test(x)) || addrCand[0] || '';

    const titleEl = document.querySelector('h1, h2, .title, .headline');
    const name = norm(titleEl ? titleEl.textContent : '');

    const txt = document.body.innerText || '';
    let category = null;
    if (/marktstand/i.test(txt)) category = 'Marktstand';
    else if (/liefer/i.test(txt)) category = 'Lieferservice';
    else if (/bioladen|markt/i.test(txt)) category = 'Bioladen';

    const openingMatch = txt.match(/(Mo|Di|Mi|Do|Fr|Sa|So)[^\\n]{0,80}\\d{1,2}[:\\.]\\d{2}/i);
    const opening = openingMatch ? openingMatch[0] : null;

    return { name, addr, email, phone, website, category, opening };
  });
  const phone = e164DE(data.phone);
  const email = (data.email && /\\S+@\\S+\\.\\S+/.test(data.email)) ? data.email.trim() : null;
  const website = (data.website && /^https?:\\/\\//i.test(data.website)) ? data.website.trim() : null;
  return { ...data, phone, email, website };
}

function parseAddress(text) {
  const parts = (text || '').split(/\\n|·|\\|/).map(norm).filter(Boolean);
  let street = null, zip = null, city = null;
  for (const seg of parts) {
    const m = seg.match(/(\\d{5})\\s+(.+)/);
    if (m) { zip = zip || m[1]; city = city || m[2]; }
    else if (!street && /\\d/.test(seg)) { street = seg; }
  }
  return { street, zip, city };
}

function buildRecord(href, data) {
  const { street, zip, city } = parseAddress(data.addr || '');
  return {
    name: data.name || null,
    street, zip, city,
    country: 'DE',
    phone: data.phone || null,
    email: data.email || null,
    website: data.website || null,
    openingHours: data.opening || null,
    detailUrl: href,
    source: 'bioladen.de',
    scrapedAt: new Date().toISOString(),
    category: data.category || null,
  };
}

await Actor.main(async () => {
  const input = await Actor.getInput() || {};
  const { radiusKm = 25, useKvPlz = false, maxCities = 9999, stateKey = 'state.json', seenPrefix = 'seen:' } = input;

  log.setLevel(log.LEVELS.INFO);
  log.info('Bioladen.de – Großstadt-PLZ (v6) startet…');

  const store = await KeyValueStore.open();
  let state = (await store.getValue(stateKey)) || { plzIndex: 0, saved: 0 };

  Actor.on('persistState', async () => { await store.setValue(stateKey, state); });
  Actor.on('migrating', async () => { await store.setValue(stateKey, state); });

  const plzList = await loadPlzList(useKvPlz, maxCities);
  log.info(`PLZ geladen: ${plzList.length} (Fortsetzung ab Index ${state.plzIndex})`);

  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  const page = await context.newPage();

  for (let i = state.plzIndex; i < plzList.length; i++) {
    const zip = String(plzList[i]);
    log.info(`>> [${i+1}/${plzList.length}] ${zip}: suche…`);
    try {
      await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch (e) {}
      await acceptCookies(page);
      await setRadius(page, radiusKm);
      await ensureVisibleAndType(page, INPUT_SEL, zip);
      await submitSearch(page);

      const ok = await waitForAnyDetailAnchors(page);
      if (!ok) {
        log.warning(`${zip}: Keine sichtbaren Detail-Links gefunden.`);
        try { await page.screenshot({ path: `debug_${zip}.png`, fullPage: true }); } catch (e) {}
        try { const html = await page.content(); await store.setValue(`debug_${zip}.html`, html, { contentType: 'text/html; charset=utf-8' }); } catch (e) {}
        state.plzIndex = i + 1;
        await store.setValue(stateKey, state);
        continue;
      }

      const links = Array.from(new Set(await collectDetailLinks(page)));
      log.info(`${zip}: gefundene Detail-Links: ${links.length}`);

      let saved = 0;
      for (const href of links) {
        const key = seenPrefix + sha1(href.toLowerCase());
        const already = await store.getValue(key);
        if (already) continue;

        const p = await context.newPage();
        try {
          await p.goto(href, { waitUntil: 'domcontentloaded' });
          try { await p.waitForLoadState('networkidle', { timeout: 8000 }); } catch (e) {}
          const data = await extractDetailsFrom(p);
          const rec = buildRecord(href, data);
          await Dataset.pushData(rec);
          await store.setValue(key, true);
          saved++; state.saved++;
        } catch (e) {
          log.warning(`Fehler beim Laden: ${href} – ${e.message}`);
        } finally {
          try { await p.close(); } catch (e) {}
        }
      }

      log.info(`<< ${zip}: saved=${saved}`);
      state.plzIndex = i + 1;
      await store.setValue(stateKey, state);

    } catch (e) {
      log.warning(`PLZ ${zip}: Fehler – ${e.message}`);
      try { await page.screenshot({ path: `debug_${zip}_err.png`, fullPage: true }); } catch (ee) {}
      state.plzIndex = i + 1;
      await store.setValue(stateKey, state);
    }
  }

  await browser.close();
  log.info(`Fertig. Insgesamt gespeichert: ${state.saved}`);
});
