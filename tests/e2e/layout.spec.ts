import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('hackalem:onboarding:v1', 'dismissed'));
});

test.use({ channel: 'chrome' });

for (const viewport of [{ width: 390, height: 360 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`layout audit ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
    page.on('console', (entry) => { if (entry.type() === 'error') browserErrors.push(`console: ${entry.text()} @ ${entry.location().url}`); });
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: 'Город', exact: true }).click();
    await expect(page.getByRole('button', { name: 'План · 0/5' })).toBeVisible();
    await expect(page.getByText('Загружаем город…')).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole('status').filter({ hasText: 'Загружаем карту Астаны' })).toBeHidden({ timeout: 20_000 });
    const overlappingMapControls = await page.evaluate(() => {
      const custom = [...document.querySelectorAll<HTMLElement>('[class*="CityMap"][class*="controls"] button')];
      const native = [...document.querySelectorAll<HTMLElement>('.maplibregl-ctrl-top-right button')];
      return custom.flatMap((button) => native.filter((control) => {
        const a = button.getBoundingClientRect();
        const b = control.getBoundingClientRect();
        return Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
      }).map((control) => `${button.textContent?.trim()} × ${control.getAttribute('aria-label')}`));
    });
    console.log(`MAP_CONTROL_OVERLAP ${viewport.width}x${viewport.height} ${JSON.stringify(overlappingMapControls)}`);
    expect(overlappingMapControls).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('city.png') });
    await page.getByRole('button', { name: 'Нура', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('zone.png') });
    await page.getByRole('button', { name: 'План · 0/5' }).click();
    await expect(page.getByRole('heading', { name: 'План для Астаны' })).toBeVisible();
    if (viewport.width === 1280) {
      await page.locator('[aria-hidden="true"] button').filter({ hasText: /^Нура$/ }).click();
      await expect(page.getByRole('combobox', { name: /Район для районных мер/ })).toContainText('Нура');
    }
    await page.screenshot({ path: testInfo.outputPath('planner.png') });
    await page.getByText('Исходные показатели пяти районов').click();
    await page.getByRole('heading', { name: 'Есиль', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('baseline.png') });
    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const panel = document.querySelector('[aria-label="Редактор городских решений"]');
      const nodes = [...(panel?.querySelectorAll('button, select, summary') ?? [])];
      const offscreen = nodes.filter((node) => { const box = node.getBoundingClientRect(); return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1); }).map((node) => (node as HTMLElement).innerText?.trim() || (node as HTMLElement).getAttribute('aria-label')).slice(0, 10);
      return { viewport: [window.innerWidth, window.innerHeight], documentWidth: root.scrollWidth, panelWidth: panel?.getBoundingClientRect().width, offscreen };
    });
    console.log(`LAYOUT_METRICS ${viewport.width}x${viewport.height} ${JSON.stringify(metrics)}`);
    console.log(`LAYOUT_ERRORS ${viewport.width}x${viewport.height} ${JSON.stringify(browserErrors.slice(0, 5))}`);
    expect(metrics.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
    expect(metrics.offscreen).toEqual([]);

    await page.getByText('Исходные показатели пяти районов').click();
    await page.getByRole('combobox', { name: /Район для районных мер/ }).click();
    await page.getByRole('option', { name: 'Нура', exact: true }).click();
    for (const id of ['M7', 'M8', 'M10', 'M12']) await page.locator('article').filter({ hasText: new RegExp(`^${id} ·`) }).getByRole('button', { name: 'Добавить в план' }).click();
    await page.getByRole('combobox', { name: /Район для районных мер/ }).click();
    await page.getByRole('option', { name: 'Сарыарка', exact: true }).click();
    await page.locator('article').filter({ hasText: /^M5 ·/ }).getByRole('button', { name: 'Добавить в план' }).click();
    await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
    await expect(page.getByRole('heading', { name: 'Итог городских решений' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('report.png') });
    await page.getByRole('heading', { name: 'Районы и показатели' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('report-table.png') });
    const report = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth, mainWidth: document.querySelector('main')?.getBoundingClientRect().width }));
    console.log(`REPORT_METRICS ${viewport.width}x${viewport.height} ${JSON.stringify(report)}`);
    expect(report.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
  });
}

for (const viewport of [{ width: 390, height: 360 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) test(`keyboard focus audit ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.getByRole('button', { name: 'Город', exact: true }).click();
  await expect(page.getByText('Загружаем город…')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Загружаем карту Астаны' })).toBeHidden({ timeout: 20_000 });
  await page.getByRole('button', { name: 'План · 0/5' }).click();
  await expect(page.getByRole('heading', { name: 'План для Астаны' })).toBeVisible();
  const focus: unknown[] = [];
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab');
    focus.push(await page.evaluate(() => {
      const active = document.activeElement as HTMLElement;
      const rect = active.getBoundingClientRect();
      const point = document.elementFromPoint(Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2)), Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2)));
      return { tag: active.tagName, text: (active.getAttribute('aria-label') || active.textContent || '').trim().slice(0, 50), inHiddenMap: Boolean(active.closest('[aria-hidden="true"]')), outerHTML: active.closest('[aria-hidden="true"]') ? active.outerHTML.slice(0, 220) : undefined, covered: Boolean(point && point !== active && !active.contains(point)), rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)] };
    }));
  }
  console.log(`FOCUS_AUDIT ${viewport.width}x${viewport.height} ${JSON.stringify(focus)}`);
  expect(focus.filter((item) => (item as { inHiddenMap: boolean }).inHiddenMap)).toEqual([]);
});
