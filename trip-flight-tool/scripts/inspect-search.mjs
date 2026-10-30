import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { SessionStore } from '../dist/browser/session.js';
import { configFromEnv } from '../dist/browser/config.js';
import { resolveLocation } from '../dist/core/locations.js';
import { submitSearch } from '../dist/providers/trip/browser.js';

const config = configFromEnv();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const events = [];
try {
  const probe = await browser.newPage();
  const userAgent = (await probe.evaluate(() => navigator.userAgent)).replace('HeadlessChrome/', 'Chrome/');
  await probe.close();
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Shanghai', userAgent, storageState: await new SessionStore(config.sessionPath).load() });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);
  await page.exposeFunction('recordSearchClick', value => events.push(value));
  await page.addInitScript(() => {
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const describe = el => ({ tag: el.tagName, role: el.getAttribute('role'), testId: el.getAttribute('data-testid'), class: el.className, text: el.textContent?.trim().slice(0, 100) });
      const ancestry = [];
      for (let el = target, i = 0; el && i < 6; el = el.parentElement, i++) ancestry.push(describe(el));
      const searches = [...document.querySelectorAll('button, [role=button], a, span')].filter(el => el.textContent?.trim() === 'Search').map(el => ({ ...describe(el), parent: el.parentElement?.className, visible: !!el.getClientRects().length }));
      const fields = ['search_city_from0', 'search_city_to0'].map(id => ({ id, html: document.querySelector(`[data-testid="${id}"]`)?.parentElement?.parentElement?.outerHTML.slice(0, 6500) }));
      void window.recordSearchClick({ ancestry, searches, fields });
    }, true);
  });
  const query = { origin: 'BJS', destination: 'PAR', departureDate: '2026-11-14', currency: 'CNY', adults: 1, cabin: 'economy', maxResults: 5 };
  try {
    await submitSearch(page, query, { origin: resolveLocation('BJS'), destination: resolveLocation('PAR') }, AbortSignal.timeout(60000));
  } catch (error) {
    events.push({ error: error.message });
  }
  events.push({ finalUrl: page.url() });
  await mkdir('artifacts/verification', { recursive: true });
  await writeFile('artifacts/verification/paris-search-click.json', JSON.stringify(events, null, 2));
  process.stdout.write(JSON.stringify(events, null, 2) + '\n');
} finally {
  await browser.close();
}
