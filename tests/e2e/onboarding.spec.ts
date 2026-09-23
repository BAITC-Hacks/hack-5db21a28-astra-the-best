import { expect, test, type Page, type TestInfo } from '@playwright/test';

test.use({ channel: 'chrome' });

async function openCityPractice(page: Page) {
  await page.goto('/');
}

async function learnCityOverview(page: Page, testInfo?: TestInfo) {
  const guide = page.getByRole('complementary', { name: 'Помощник градоначальника' });
  await expect(guide.getByRole('button', { name: 'Следующий показатель', exact: true })).toHaveCount(0);
  if (testInfo) await page.screenshot({ path: testInfo.outputPath('city-indicators-overview.png') });
  await guide.getByRole('button', { name: 'Сравнить районы', exact: true }).click();
  await checkSpotlight(page);
  await expect(guide.getByRole('heading', { name: 'Теперь посмотрим на весь город', exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'Показатели района Нура', exact: true }).getByRole('button', { name: 'Закрыть', exact: true }).click();
  await checkSpotlight(page);
  await page.getByRole('combobox', { name: 'Слой показателей', exact: true }).click();
  await page.getByRole('option', { name: 'Школы и детсады', exact: true }).click();
  await expect(guide.getByRole('heading', { name: 'Сравните районы по одному показателю', exact: true })).toBeVisible();
  await checkSpotlight(page);
  if (testInfo) await page.screenshot({ path: testInfo.outputPath('city-indicator-comparison.png') });
  await guide.getByRole('button', { name: 'Понятно, составим план', exact: true }).click();
  await page.locator('[data-guide-zone="nura"]').click();
}

async function districtAndLegendColor(page: Page, value: string) {
  const districtNumber = page.locator('[data-guide-indicator="S1"] dd');
  const legendNumber = page.locator('[data-guide-zone="nura"] strong');
  await expect(districtNumber).toContainText(value);
  await expect(legendNumber).toHaveText(value);
  const districtColor = await districtNumber.evaluate((element) => getComputedStyle(element).color);
  const legendColor = await legendNumber.evaluate((element) => getComputedStyle(element).color);
  expect(districtColor).toBe(legendColor);
  return districtColor;
}

async function checkSpotlight(page: Page) {
  await expect(page.locator('[data-tour-spotlight]')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const ring = document.querySelector('[data-tour-spotlight]')!.getBoundingClientRect();
    const card = document.querySelector('[data-tour-card]')!.getBoundingClientRect();
    const separated = card.right <= ring.left || card.left >= ring.right || card.bottom <= ring.top || card.top >= ring.bottom;
    const fits = card.left >= 0 && card.right <= innerWidth + 1 && card.top >= 0 && card.bottom <= innerHeight + 1;
    return separated && fits;
  }), { timeout: 5000 }).toBe(true);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 390, height: 360 }]) {
  test(`onboarding: mayor journey ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    let aiRequests = 0;
    let simulationRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/simulate') simulationRequests++;
    });
    await page.route('**/api/analyze', async (route) => {
      aiRequests++;
      if (aiRequests > 1) {
        const computed = await (await page.request.post('/api/simulate', { data: route.request().postDataJSON() })).json();
        const statement = { text: 'Тестовый ответ ИИ по рассчитанному сценарию.', factIds: ['score-after'] };
        await route.fulfill({ json: { datasetVersion: computed.datasetVersion, scenarioId: computed.scenarioId, provider: 'test-fixture', model: 'fixture', facts: [{ id: 'score-after', label: 'Итоговый балл', value: computed.result.score, unit: 'балла' }], analysis: { summary: statement, strengths: [statement], risks: [statement], consequences: [statement], recommendation: statement } } });
        return;
      }
      await route.fulfill({ status: 503, json: { error: { code: 'AI_UNAVAILABLE', message: 'Тестовая ошибка ИИ', issues: [] } } });
    });
    await openCityPractice(page);
    const welcome = page.getByRole('dialog');
    await expect(welcome).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('welcome.png') });
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      expect(await welcome.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await welcome.getByRole('button', { name: 'Вступить в должность' }).click();
    const guide = page.getByRole('complementary', { name: 'Помощник градоначальника' });
    await expect(guide.getByRole('heading', { name: 'Начнём с жителей Нуры' })).toBeVisible();
    await checkSpotlight(page);
    await page.screenshot({ path: testInfo.outputPath('arrow.png') });
    await page.getByRole('button', { name: 'Нура', exact: true }).click();
    await expect(guide.getByRole('heading', { name: /Нура: узнайте/ })).toBeVisible();
    await checkSpotlight(page);
    await learnCityOverview(page, testInfo);
    const beforeColor = await districtAndLegendColor(page, '38,00');
    expect(aiRequests).toBe(0);
    expect(simulationRequests).toBe(0);
    await checkSpotlight(page);
    await page.getByRole('button', { name: 'План · 0/5' }).click();
    for (const id of ['M7', 'M8', 'M10', 'M12', 'M5']) {
      const addButton = page.locator('article').filter({ hasText: new RegExp(`^${id} ·`) }).getByRole('button', { name: 'Добавить в план' });
      await expect(addButton).toBeFocused();
      await checkSpotlight(page);
      if (id === 'M7') await page.screenshot({ path: testInfo.outputPath('measure.png') });
      await addButton.click();
      if (id === 'M7') {
        await expect(guide.getByRole('heading', { name: 'Первое решение уже в плане' })).toBeVisible();
        await checkSpotlight(page);
        await guide.getByRole('button', { name: 'Добавить следующее решение' }).click();
      }
    }
    await expect(guide.getByRole('heading', { name: 'Узнайте, что изменится в городе' })).toBeVisible();
    await checkSpotlight(page);
    await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
    await expect(guide.getByRole('heading', { name: 'Вот результат вашей работы' })).toBeVisible();
    expect(simulationRequests).toBe(1);
    await checkSpotlight(page);
    expect(aiRequests).toBe(0);
    await guide.getByRole('button', { name: 'А кому стало лучше?' }).click();
    await checkSpotlight(page);
    await guide.getByRole('button', { name: 'Перейти к ИИ-разбору' }).click();
    await checkSpotlight(page);
    expect(aiRequests).toBe(0);
    await page.getByRole('button', { name: 'Получить AI-анализ' }).click();
    await expect(guide.getByRole('heading', { name: 'ИИ не ответил. Ваш расчёт сохранён' })).toBeVisible();
    await checkSpotlight(page);
    expect(aiRequests).toBe(1);
    if (viewport.width === 1280) {
      await page.getByRole('button', { name: 'Повторить AI-анализ' }).click();
      await expect(guide.getByRole('heading', { name: 'Вы освоили управление городом' })).toBeVisible();
      await checkSpotlight(page);
      expect(aiRequests).toBe(2);
      await guide.getByRole('button', { name: 'Начать управлять самостоятельно' }).click();
    } else await guide.getByRole('button', { name: 'Завершить без ИИ' }).click();
    await expect(guide).toHaveCount(0);
    await page.getByRole('button', { name: /Обучение/ }).click();
    await welcome.getByRole('button', { name: 'Вступить в должность' }).click();
    await expect(guide.getByRole('heading', { name: /Нура: узнайте/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);
    const afterColor = await districtAndLegendColor(page, '48,00');
    expect(afterColor).not.toBe(beforeColor);
    await page.screenshot({ path: testInfo.outputPath('city-colored-indicators-after.png') });
    await page.getByRole('button', { name: 'План · 5/5' }).click();
    await page.getByRole('button', { name: /^Удалить / }).first().click();
    await expect(page.getByRole('button', { name: 'Рассчитать сценарий' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('onboarding: skip persists, replay works and Escape dismisses', async ({ page }) => {
  await openCityPractice(page);
  await page.getByRole('button', { name: 'Освоюсь самостоятельно' }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: '3D-карта Астаны' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /Обучение/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Обучение/ })).toBeFocused();
});

test('onboarding: unavailable map still lets the mayor select a district and open the plan', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await openCityPractice(page);
  await page.getByRole('button', { name: 'Вступить в должность' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить карту' })).toBeVisible();
  await checkSpotlight(page);
  await page.getByRole('button', { name: 'Нура', exact: true }).click();
  await learnCityOverview(page);
  await page.getByRole('button', { name: 'План · 0/5' }).click();
  await expect(page.getByRole('heading', { name: 'Добавьте ваше первое решение' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Помощник градоначальника' })).toHaveCount(0);
});
