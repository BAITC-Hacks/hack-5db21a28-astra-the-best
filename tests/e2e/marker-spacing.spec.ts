import { expect, test, type Page } from '@playwright/test';

test.use({ channel: 'chrome' });

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem('hackalem:onboarding:v1', 'dismissed'));
  // Exercise real WebGL projection and HTML markers without external tile availability.
  await page.route('https://tiles.openfreemap.org/styles/liberty*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef2ec' } }] }),
  }));
});

async function markerGeometry(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.maplibregl-canvas')!.getBoundingClientRect();
    const all = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
      .filter((button) => /^M\d+:/.test(button.getAttribute('aria-label') ?? ''))
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return { id: button.getAttribute('aria-label'), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
    const visible = all.filter((box) => box.width > 0 && box.height > 0 && box.right > canvas.left && box.left < canvas.right && box.bottom > canvas.top && box.top < canvas.bottom);
    const overlaps = visible.flatMap((a, i) => visible.slice(i + 1).filter((b) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
    ).map((b) => `${a.id} / ${b.id}`));
    return { count: all.length, visible: visible.length, overlaps, positions: JSON.stringify(all.map((box) => [Math.round(box.left), Math.round(box.top)])) };
  });
}

async function expectSeparated(page: Page, minimumVisible: number) {
  let lastPositions = '';
  let stableSince = Date.now();
  await expect.poll(async () => {
    const geometry = await markerGeometry(page);
    if (geometry.positions !== lastPositions) { lastPositions = geometry.positions; stableSince = Date.now(); }
    return geometry.count === 21 && geometry.overlaps.length === 0 && Date.now() - stableSince >= 250;
  }, { message: 'All 21 badges must settle without overlapping', intervals: [100], timeout: 10_000 }).toBe(true);
  expect((await markerGeometry(page)).visible).toBeGreaterThanOrEqual(minimumVisible);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 390, height: 360 }]) {
  test(`dense plan badges stay separate through camera and viewport changes ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('status').filter({ hasText: 'Загружаем карту Астаны' })).toBeHidden();
    await page.getByRole('button', { name: 'План · 0/5' }).click();
    await page.getByRole('combobox', { name: 'Район для районных мер' }).click();
    await page.getByRole('option', { name: 'Нура', exact: true }).click();
    // Four city-wide measures (20 signs) plus a park in Nura: budget 87, valid directions.
    for (const id of ['M2', 'M6', 'M12', 'M14', 'M4']) {
      await page.locator('article').filter({ hasText: new RegExp(`^${id} ·`) }).getByRole('button', { name: 'Добавить в план' }).click();
    }
    await expect(page.getByRole('button', { name: 'Рассчитать сценарий' })).toBeEnabled();
    await page.getByRole('button', { name: 'Скрыть план' }).click();
    // A district detail sheet intentionally covers the map on compact screens.
    await page.getByRole('region', { name: 'Показатели района Нура' }).getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expectSeparated(page, 21);
    await page.screenshot({ path: testInfo.outputPath('dense-overview.png') });

    await page.locator('.maplibregl-ctrl-zoom-out').click();
    await expectSeparated(page, 21);
    await page.screenshot({ path: testInfo.outputPath('dense-zoomed-out.png') });

    await page.locator('.maplibregl-ctrl-compass').click();
    await expectSeparated(page, 21);
    await page.setViewportSize({ width: viewport.width + 80, height: viewport.height + 40 });
    await expectSeparated(page, 21);

    await page.locator('.maplibregl-canvas').press('ArrowRight');
    await expectSeparated(page, 1);

    await page.getByRole('button', { name: 'Весь город', exact: true }).click();
    await expectSeparated(page, 21);
    // Each sign remains individually clickable, including the park from the reported stack.
    const park = page.locator('button[aria-label^="M4:"]');
    await park.click();
    await expect(page.locator('.maplibregl-popup').getByRole('heading', { name: /Парк/ })).toBeVisible();
  });
}
