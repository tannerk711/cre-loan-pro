// QA driver: walks the whole onboarding survey end to end against the dev
// server, screenshotting key steps at desktop + mobile, then submits for real
// (LEAD_WEBHOOK_URL unset in dev -> server logs payload and returns ok).
// Desktop uploads a real test logo (exercises the multipart path); mobile
// takes the skip path on both file steps.
//
// Usage: node tools/qa.mjs [pass-name]
// Output: tools/shots/<pass>-<device>-<step>.png

import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'shots');
mkdirSync(outDir, { recursive: true });
const pass = process.argv[2] || 'pass1';

// tiny valid PNG (red 8x8) for the logo-upload path
const TEST_LOGO = join(here, 'test-logo.png');
if (!existsSync(TEST_LOGO)) {
  writeFileSync(TEST_LOGO, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP8z8Dwn4EIwESMolGFtFEIAJDcAgH4Yzo+AAAAAElFTkSuQmCC',
    'base64'
  ));
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!CHROME) { console.error('Chrome not found'); process.exit(1); }

const URL = 'http://localhost:4321/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickText(page, text) {
  const ok = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent.trim().startsWith(t)
    );
    if (btn) { btn.click(); return true; }
    return false;
  }, text);
  if (!ok) throw new Error(`button not found: "${text}"`);
  await sleep(420);
}

async function type(page, placeholder, value) {
  const sel = `input[placeholder="${placeholder}"], textarea[placeholder^="${placeholder.slice(0, 12)}"]`;
  await page.waitForSelector(sel, { timeout: 4000 });
  await page.click(sel);
  await page.type(sel, value, { delay: 5 });
}

async function shot(page, device, name) {
  await page.screenshot({ path: join(outDir, `${pass}-${device}-${name}.png`) });
  console.log(`shot: ${pass}-${device}-${name}.png`);
}

async function run(device, viewport) {
  const uploadLogo = device === 'desktop';
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle0' });

  await shot(page, device, '01-welcome');

  // validation state check: start, then try to continue with empty name
  await clickText(page, 'Start');
  await clickText(page, 'Continue');
  await shot(page, device, '02-validation-error');

  // Section 1: You + your license
  await type(page, 'First name', 'Marcus');
  await type(page, 'Last name', 'Delgado');
  await clickText(page, 'Continue');
  await type(page, 'e.g. Barrett Financial Group', 'Delgado Capital Lending');
  await clickText(page, 'Continue');
  await type(page, 'e.g. 239185', '1234567');
  await clickText(page, 'Continue');
  await clickText(page, 'Skip'); // company NMLS optional
  for (const st of ['AZ', 'TX', 'FL']) await clickText(page, st);
  await shot(page, device, '03-states-licensed');
  await clickText(page, 'Continue');
  await clickText(page, 'Let me pick');
  await clickText(page, 'TX');
  await clickText(page, 'FL');
  await shot(page, device, '04-states-wanted-pick');
  await clickText(page, 'Continue');

  // Section 2: Your profile
  await shot(page, device, '05-logo-empty');
  if (uploadLogo) {
    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(TEST_LOGO);
    await sleep(400);
    await shot(page, device, '05b-logo-picked');
    await clickText(page, 'Continue');
  } else {
    await clickText(page, 'Skip');
  }
  await clickText(page, 'Skip'); // headshot
  await type(page, 'Paste the link', 'g.page/delgado-capital'); // tests https:// normalization
  await shot(page, device, '06-reviews-link');
  await clickText(page, 'Continue');

  // Section 3: Lead delivery
  await type(page, '(555) 123-4567', '+15125550142'); // autofill +1 strip check
  const phoneVal = await page.$eval('input[type="tel"]', (i) => i.value);
  if (phoneVal !== '(512) 555-0142') throw new Error(`phone format broke: "${phoneVal}"`);
  await clickText(page, 'Continue');
  await type(page, 'you@yourshop.com', 'marcus@delgadocap.com');
  await clickText(page, 'Continue');
  await clickText(page, 'Text me');
  await clickText(page, 'Straight into my CRM');
  await shot(page, device, '07-delivery-channels');
  await clickText(page, 'Continue');
  await clickText(page, 'Other'); // CRM Other -> free text appears
  await sleep(200);
  await type(page, 'Which one?', 'Shape');
  await shot(page, device, '08-crm-other');
  await clickText(page, 'Continue');
  await clickText(page, 'Under 5 minutes'); // auto-advance

  // Section 4: Capacity + products
  await clickText(page, '10 to 20'); // auto-advance
  await clickText(page, 'Purchase');
  await clickText(page, 'Cash-out refi');
  await clickText(page, 'Short-term rental');
  await clickText(page, 'Continue');
  await clickText(page, 'Single family');
  await clickText(page, '2-4 unit');
  await clickText(page, 'Continue');
  await page.select('select', '$100K');
  const sels = await page.$$('select');
  await sels[1].select('$2M');
  await shot(page, device, '09-loan-range');
  await clickText(page, 'Continue');
  await type(page, 'Optional, but this is the one', 'No rural, nothing under 620.');
  await clickText(page, 'Continue');

  // Section 5: Billing
  await type(page, 'e.g. Peisner Lending LLC', 'Delgado Capital LLC');
  await clickText(page, 'Continue');
  await clickText(page, 'Same as lead email');
  await shot(page, device, '10-billing-samefill');
  await clickText(page, 'Continue');
  await clickText(page, 'ACH / bank transfer'); // auto-advance
  await shot(page, device, '11-notes-final');
  await clickText(page, 'Lock it in');
  await page.waitForFunction(
    () => document.body.textContent.includes("That's everything we need."),
    { timeout: 15000 }
  );
  await sleep(1200); // let the check-draw animation finish
  await shot(page, device, '12-success');

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log(`${device}: full walk OK, submit OK (logo ${uploadLogo ? 'uploaded' : 'skipped'})`);
}

await run('desktop', { width: 1440, height: 900 });
await run('mobile', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
console.log('QA PASS COMPLETE');
