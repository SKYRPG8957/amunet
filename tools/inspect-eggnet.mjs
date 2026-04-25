import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(
  'file:///C:/Users/a0103/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js',
);
const { chromium } = require('playwright');

const outDir = path.resolve('artifacts', 'eggnet');
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'ko-KR',
});
const page = await context.newPage();

const apiResponses = [];
page.on('response', async (response) => {
  const url = response.url();
  if (!url.includes('/api/')) return;

  let body = null;
  try {
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('application/json')) body = await response.json();
  } catch {
    body = null;
  }

  apiResponses.push({ url, status: response.status(), body });
});

await page.goto('https://eggnet.space/', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(4500);
await page.screenshot({ path: path.join(outDir, '01-language.png'), fullPage: false });

// Choose Korean from the real language selection screen.
await page.mouse.click(344, 134);
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(7000);
await page.screenshot({ path: path.join(outDir, '02-main-ko.png'), fullPage: false });

const afterLanguageUrl = page.url();

// Use the visible search bar in the app.
await page.mouse.click(210, 195);
await page.keyboard.insertText('한성부');
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(outDir, '03-search-hanseong.png'), fullPage: false });

// Open the first visible card/details by clicking the card title area.
await page.mouse.click(500, 252);
await page.waitForTimeout(1600);
await page.screenshot({ path: path.join(outDir, '04-detail-or-selected.png'), fullPage: false });

// Click the visible join area only far enough to observe the app's behavior.
// Do not approve external-protocol prompts if a browser shows one.
const beforeJoinUrl = page.url();
await page.mouse.click(1384, 255);
await page.waitForTimeout(1600);
await page.screenshot({ path: path.join(outDir, '05-after-join-click.png'), fullPage: false });

const storage = await page.evaluate(() => ({
  localStorage: Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return [key, key ? localStorage.getItem(key) : null];
    }).filter(([key]) => key),
  ),
  sessionStorage: Object.fromEntries(
    Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index);
      return [key, key ? sessionStorage.getItem(key) : null];
    }).filter(([key]) => key),
  ),
}));

const summary = {
  title: await page.title(),
  afterLanguageUrl,
  finalUrl: page.url(),
  urlChangedAfterJoinClick: beforeJoinUrl !== page.url(),
  storage,
  apiResponses: apiResponses.map((item) => ({
    url: item.url,
    status: item.status,
    ok: item.body?.ok,
    source: item.body?.source,
    mode: item.body?.mode,
    count: item.body?.count,
    version: item.body?.version,
    firstServer: item.body?.servers?.[0]
      ? {
          serverId: item.body.servers[0].serverId,
          source: item.body.servers[0].source,
          title: item.body.servers[0].title,
          ownerXuid: item.body.servers[0].ownerXuid,
          ownerGamertag: item.body.servers[0].ownerGamertag,
          handleId: JSON.parse(item.body.servers[0].note || '{}')?.world?.handle?.handleId,
        }
      : null,
  })),
  screenshots: [
    path.join(outDir, '01-language.png'),
    path.join(outDir, '02-main-ko.png'),
    path.join(outDir, '03-search-hanseong.png'),
    path.join(outDir, '04-detail-or-selected.png'),
    path.join(outDir, '05-after-join-click.png'),
  ],
};

await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
