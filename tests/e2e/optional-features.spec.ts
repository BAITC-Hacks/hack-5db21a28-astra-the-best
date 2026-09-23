import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test.use({ channel: 'chrome' });
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('hackalem:onboarding:v1', 'dismissed'));
});

async function controlPlan(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'План · 0/5' }).click();
  const chooseDistrict = async (name: string) => {
    await page.getByRole('combobox', { name: 'Район для районных мер' }).click();
    await page.getByRole('option', { name, exact: true }).click();
  };
  await chooseDistrict('Нура');
  for (const id of ['M7', 'M8', 'M10', 'M12']) {
    await page.locator('article').filter({ hasText: new RegExp(`^${id} ·`) }).getByRole('button', { name: 'Добавить в план' }).click();
  }
  await chooseDistrict('Сарыарка');
  await page.locator('article').filter({ hasText: /^M5 ·/ }).getByRole('button', { name: 'Добавить в план' }).click();
  await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
  await expect(page.getByRole('heading', { name: 'Итог городских решений' })).toBeVisible();
}

test('saved scenarios survive reload and a checked improvement is loaded as a draft', async ({ page }) => {
  await controlPlan(page);
  const panel = page.getByRole('region', { name: 'Сравнение сценариев', exact: true });
  await panel.getByLabel('Название сценария').fill('Контрольный 95');
  await panel.getByRole('button', { name: 'Сохранить текущий сценарий' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Отчёт', exact: true }).click();
  await panel.getByRole('button', { name: 'Открыть Контрольный 95', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'План для Астаны' })).toBeVisible();
  await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
  await panel.getByRole('button', { name: 'Найти проверяемое улучшение' }).click();
  await panel.getByRole('button', { name: 'Перенести улучшение в план' }).click();
  await expect(page.getByRole('heading', { name: 'План для Астаны' })).toBeVisible();
  const result = page.waitForResponse((response) => response.url().endsWith('/api/simulate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
  const data = await (await result).json();
  expect(data.result.score).toBeGreaterThan(56.54307);
  expect(data.decisions).toHaveLength(5);
  expect(data.cost).toBeLessThanOrEqual(100);
});

test('report downloads contain the exact current scenario without invented AI', async ({ page }) => {
  await controlPlan(page);
  for (const format of ['JSON', 'HTML / PDF']) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: format === 'JSON' ? 'Скачать данные · JSON' : 'Скачать отчёт · HTML / PDF' }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    const content = await readFile(path!, 'utf8');
    if (format === 'JSON') {
      const report = JSON.parse(content);
      expect(report.simulation.cost).toBe(95);
      expect(report.simulation.result.score).toBeCloseTo(56.54307, 5);
      expect(report.simulation.decisions).toHaveLength(5);
    } else {
      const exactScore = content.match(/Точное значение Score без округления: ([\d.]+)/)?.[1];
      expect(Number(exactScore)).toBeCloseTo(56.54307, 5);
      expect(content).toContain('AI-анализ для этого сценария отсутствует');
      expect(content).toContain('Сохранить как PDF');
    }
  }
});

test('optional controls fit mobile and decorative movement can be disabled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const decoration = page.getByRole('button', { name: 'Декоративное движение', exact: true });
  await expect(decoration).toHaveAttribute('aria-pressed', 'true');
  await decoration.click();
  await expect(decoration).toHaveAttribute('aria-pressed', 'false');
  await controlPlan(page);
  await expect(page.getByRole('region', { name: 'Сравнение сценариев', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
