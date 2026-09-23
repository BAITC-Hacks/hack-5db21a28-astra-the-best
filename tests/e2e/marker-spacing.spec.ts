import { expect, test, type Page } from '@playwright/test';

test.use({ channel: 'chrome' });
test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem('hackalem:onboarding:v1', 'dismissed'));
  // Real MapLibre projection and our district geometry, independent of tile outages.
  await page.route('https://tiles.openfreemap.org/styles/liberty*', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef2ec' } }] }),
  }));
});
async function pins(page: Page) {
  return page.locator('button[data-measure]').evaluateAll(buttons => buttons.map(button => {
    const element = button as HTMLElement;
    const rect = element.getBoundingClientRect();
    return { key: `${element.dataset.measure}-${element.dataset.district}`, longitude: element.dataset.longitude, latitude: element.dataset.latitude, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.bottom) };
  }));
}
async function settle(page: Page, count: number) {
  let previous = '', since = Date.now();
  await expect.poll(async () => {
    const current = await pins(page), signature = JSON.stringify(current);
    if (signature !== previous) { previous = signature; since = Date.now(); }
    return current.length === count && Date.now() - since > 250;
  }, { intervals: [100], timeout: 10_000 }).toBe(true);
}
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 390, height: 360 }]) {
  test(`fixed geographic pins and selected measure area ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: 'План · 0/5' }).click();
    await page.getByRole('combobox', { name: 'Район для районных мер' }).click();
    await page.getByRole('option', { name: 'Нура', exact: true }).click();
    for (const id of ['M2', 'M6', 'M12', 'M14', 'M4']) await page.locator('article').filter({ hasText: new RegExp(`^${id} ·`) }).getByRole('button', { name: 'Добавить в план' }).click();
    await page.getByRole('button', { name: 'Скрыть план' }).click();
    await page.getByRole('region', { name: 'Показатели района Нура' }).getByRole('button', { name: 'Закрыть', exact: true }).click();
    await settle(page, 21);
    const original = await pins(page);
    await expect(page.locator('[class*="CityEffects"][class*="leaders"]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('fixed-pins.png') });
    // Removing neighbours must not repack or move the remaining signs.
    await page.getByRole('button', { name: 'План · 5/5' }).click();
    await page.getByRole('button', { name: 'Удалить Городская программа озеленения и ветрозащитных полос', exact: true }).click();
    await page.getByRole('button', { name: 'Скрыть план' }).click();
    await settle(page, 16);
    for (const pin of await pins(page)) expect(pin).toEqual(original.find(other => other.key === pin.key));
    const coordinates = (await pins(page)).map(({ key, longitude, latitude }) => ({ key, longitude, latitude }));
    await page.locator('.maplibregl-ctrl-zoom-out').click();
    await settle(page, 16);
    await page.locator('.maplibregl-canvas').press('ArrowRight');
    await settle(page, 16);
    await page.locator('.maplibregl-ctrl-compass').click();
    await settle(page, 16);
    await page.setViewportSize({ width: viewport.width + 40, height: viewport.height + 20 });
    await settle(page, 16);
    expect((await pins(page)).map(({ key, longitude, latitude }) => ({ key, longitude, latitude }))).toEqual(coordinates);
    await page.getByRole('button', { name: 'Весь город', exact: true }).click();
    await settle(page, 16);
    const park = page.locator('button[data-measure="M4"]');
    await park.press('Enter');
    await expect(park).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.maplibregl-popup')).toContainText('Область действия: Нура');
    await expect(page.locator('.maplibregl-popup a[href^="https://www.openstreetmap.org/"]')).toBeVisible();
    const popupBox = await page.locator('.maplibregl-popup').boundingBox();
    expect(popupBox!.y).toBeGreaterThanOrEqual(0);
    expect(popupBox!.y + popupBox!.height).toBeLessThanOrEqual(viewport.height + 20);
    await page.screenshot({ path: info.outputPath('district-impact.png') });
    await page.locator('.maplibregl-popup-close-button').click();
    await expect(park).toHaveAttribute('aria-pressed', 'false');
    const city = page.locator('button[data-measure="M12"][data-district="nura"]');
    await city.press('Enter');
    await expect(page.locator('button[data-measure="M12"][class*="selected"]')).toHaveCount(5);
    await expect(page.locator('.maplibregl-popup')).toContainText('Область действия: все пять игровых районов');
    await page.screenshot({ path: info.outputPath('city-impact.png') });
    await city.press('Escape');
    await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
    await expect(page.locator('button[data-measure][class*="selected"]')).toHaveCount(0);
  });
}
