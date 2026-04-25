import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(
  'file:///C:/Users/a0103/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js',
);
const { chromium } = require('playwright');

const outDir = path.resolve('artifacts', 'local');
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});

async function inspectViewport(name, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: 'ko-KR',
  });
  const page = await context.newPage();
  const consoleErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.server-card', { timeout: 30000 });
  await page.screenshot({ path: path.join(outDir, `${name}-servers.png`), fullPage: false });

  const cardCount = await page.locator('.server-card').count();
  await page.locator('.join-button').first().click();
  await page.waitForSelector('.join-modal', { timeout: 8000 });
  await page.screenshot({ path: path.join(outDir, `${name}-join-modal.png`), fullPage: false });
  const modalTitle = await page.locator('.join-modal h2').innerText();

  await context.close();
  return {
    name,
    viewport,
    cardCount,
    modalTitle,
    consoleErrors,
    screenshots: [
      path.join(outDir, `${name}-servers.png`),
      path.join(outDir, `${name}-join-modal.png`),
    ],
  };
}

const results = [
  await inspectViewport('desktop', { width: 1440, height: 900 }),
  await inspectViewport('mobile', { width: 390, height: 844 }),
];

await browser.close();

const summary = {
  ok: results.every((result) => result.cardCount > 0 && result.consoleErrors.length === 0),
  results,
};

await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
