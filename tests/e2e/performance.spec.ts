import { chromium, expect, test } from '@playwright/test';

test.use({ channel: 'chrome' });
test.describe.configure({ mode: 'serial' });

test('1920×1080 map timing and 30-second frame sample', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem('hackalem:onboarding:v1', 'dismissed'));
  const page = await context.newPage();
  try {
    await page.goto('/');
    await page.locator('canvas.maplibregl-canvas').waitFor({ state: 'visible' });
    await expect(page.getByRole('status').filter({ hasText: 'Загружаем карту Астаны' })).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole('alert').filter({ hasText: /Не удалось загрузить карту/ })).toHaveCount(0);
    const firstMapMs = await page.evaluate(() => performance.now());

    const latency = page.evaluate(() => new Promise<number>((resolve) => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Нура');
      if (!button) { resolve(Number.NaN); return; }
      let started = 0;
      const observer = new MutationObserver(() => {
        if (started && button.getAttribute('aria-pressed') === 'true') { observer.disconnect(); resolve(performance.now() - started); }
      });
      observer.observe(button, { attributes: true, attributeFilter: ['aria-pressed'] });
      button.addEventListener('click', () => { started = performance.now(); }, { capture: true, once: true });
    }));
    await page.getByRole('button', { name: 'Нура', exact: true }).click();
    const selectionMs = await latency;

    const frames = page.evaluate(() => new Promise<number[]>((resolve) => {
      const intervals: number[] = [];
      const start = performance.now();
      let previous = 0;
      const sample = (now: number) => {
        if (previous) intervals.push(now - previous);
        previous = now;
        if (now - start < 30_000) requestAnimationFrame(sample); else resolve(intervals);
      };
      requestAnimationFrame(sample);
    }));
    for (let index = 0; index < 12; index++) {
      await page.getByRole('button', { name: index % 2 ? 'Весь город' : '3D центр' }).click();
      await page.waitForTimeout(2200);
    }
    const intervals = (await frames).filter((value) => value > 0 && value < 1000).sort((a, b) => a - b);
    const medianFps = 1000 / intervals[Math.floor(intervals.length / 2)];
    const metrics = { firstMapMs: Math.round(firstMapMs), selectionMs: Math.round(selectionMs), medianFps: Math.round(medianFps * 10) / 10, samples: intervals.length };
    console.log(`PERF_METRICS ${JSON.stringify(metrics)}`);
    expect(Number.isFinite(medianFps)).toBeTruthy();
  } finally { await context.close(); }
});

test('WebGL failure keeps plan and report accessible', async () => {
  test.setTimeout(60_000);
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-webgl', '--disable-webgl2', '--disable-software-rasterizer'] });
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('hackalem:onboarding:v1', 'dismissed'));
  const page = await context.newPage();
  try {
    await page.goto('/');
    const available = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl')));
    expect(available).toBe(false);
    await expect(page.getByRole('alert').filter({ hasText: /Не удалось загрузить карту/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'План · 0/5' }).click();
    await expect(page.getByRole('heading', { name: 'План для Астаны' })).toBeVisible();
    await page.getByRole('button', { name: 'Отчёт', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Отчёт появится после расчёта' })).toBeVisible();
  } finally { await context.close(); await browser.close(); }
});
