import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('hackalem:onboarding:v1', 'dismissed'));
});

test.use({ channel: 'chrome' });

const control = [
  { measureId: 'M7', districtId: 'nura' },
  { measureId: 'M8', districtId: 'nura' },
  { measureId: 'M10', districtId: 'nura' },
  { measureId: 'M12' },
  { measureId: 'M5', districtId: 'saryarka' },
];

async function chooseMenu(page: import('@playwright/test').Page, label: string, option: string) {
  await page.getByRole('combobox', { name: new RegExp(label) }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function buildControlPlan(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'План · 0/5' }).click();
  await chooseMenu(page, 'Район для районных мер', 'Нура');
  for (const id of ['M7', 'M8', 'M10', 'M12']) await page.locator('article').filter({ hasText: new RegExp(`^${id} ·`) }).getByRole('button', { name: 'Добавить в план' }).click();
  await expect(page.getByRole('button', { name: 'Рассчитать сценарий' })).toBeDisabled();
  await chooseMenu(page, 'Район для районных мер', 'Сарыарка');
  await page.locator('article').filter({ hasText: /^M5 ·/ }).getByRole('button', { name: 'Добавить в план' }).click();
}

test('two new sessions share the same baseline and the control result', async ({ browser, request }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const [a, b] = await Promise.all([first.request.get('/api/scenario'), second.request.get('/api/scenario')]);
    expect(a.ok()).toBeTruthy(); expect(b.ok()).toBeTruthy();
    const firstScenario = await a.json(); const secondScenario = await b.json();
    expect(firstScenario).toEqual(secondScenario);
    expect(firstScenario.districts).toHaveLength(5);
    expect(firstScenario.measures).toHaveLength(14);
    const response = await request.post('/api/simulate', { data: { datasetVersion: firstScenario.datasetVersion, decisions: control } });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.cost).toBe(95);
    expect(result.remainingBudget).toBe(5);
    expect(result.baseline.score).toBeCloseTo(52.55768, 5);
    expect(result.result.score).toBeCloseTo(56.54307, 5);
    expect(result.scoreDelta).toBeCloseTo(3.98539, 5);
  } finally { await first.close(); await second.close(); }
});

test('server rejects incomplete, duplicate, over-budget, direction and conflict cases', async ({ request }) => {
  const scenario = await (await request.get('/api/scenario')).json();
  const cases = [
    { decisions: control.slice(0, 4), code: 'DECISION_COUNT' },
    { decisions: [...control, { measureId: 'M11', districtId: 'nura' }], code: 'DECISION_COUNT' },
    { decisions: [...control.slice(0, 4), control[0]], code: 'DUPLICATE_MEASURE' },
    { decisions: [{ measureId: 'M3', districtId: 'nura' }, { measureId: 'M5', districtId: 'saryarka' }, { measureId: 'M7', districtId: 'nura' }, { measureId: 'M8', districtId: 'nura' }, { measureId: 'M13', districtId: 'almaty' }], code: 'BUDGET_EXCEEDED' },
    { decisions: [{ measureId: 'M7', districtId: 'nura' }, { measureId: 'M8', districtId: 'nura' }, { measureId: 'M9', districtId: 'nura' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }], code: 'DIRECTION_LIMIT' },
    { decisions: [{ measureId: 'M1', districtId: 'nura' }, { measureId: 'M3', districtId: 'esil' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M11', districtId: 'nura' }, { measureId: 'M12' }], code: 'INCOMPATIBLE_MEASURES' },
  ];
  for (const item of cases) {
    const response = await request.post('/api/simulate', { data: { datasetVersion: scenario.datasetVersion, decisions: item.decisions } });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.error.issues.map((issue: { code: string }) => issue.code)).toContain(item.code);
    expect(body.result).toBeUndefined();
  }
});

test('user can build the 95-unit plan and read the report', async ({ page }) => {
  await buildControlPlan(page);
  await expect(page.getByRole('heading', { name: 'План для Астаны' })).toBeVisible();
  await expect(page.getByText('500 млн ₸ / 10 млрд ₸')).toBeVisible();
  await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
  await expect(page.getByRole('heading', { name: 'Итог городских решений' })).toBeVisible();
  await expect(page.getByText('56,54', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Районы и показатели' }).locator('..').locator('tbody tr')).toHaveCount(50);
  await expect(page.getByRole('heading', { name: 'Синергии' })).toBeVisible();
  await expect(page.getByText(/Освещение и камеры.*Единая цифровая платформа/).first()).toBeVisible();
});

test('changing a valid district changes Score; restoring it reproduces the control', async ({ request }) => {
  const scenario = await (await request.get('/api/scenario')).json();
  const calculate = async (decisions: typeof control) => (await request.post('/api/simulate', { data: { datasetVersion: scenario.datasetVersion, decisions } })).json();
  const original = await calculate(control);
  const changed = await calculate([...control.slice(0, 4), { measureId: 'M5', districtId: 'nura' }]);
  const restored = await calculate(control);
  expect(changed.result.score).not.toBe(original.result.score);
  expect(restored.result.score).toBe(original.result.score);
  expect(restored.scenarioId).toBe(original.scenarioId);
});

test('AI failure and retry preserve the calculated report', async ({ page }) => {
  await buildControlPlan(page);
  await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
  await expect(page.getByText('56,54', { exact: true }).first()).toBeVisible();
  let calls = 0;
  await page.route('**/api/analyze', async (route) => {
    calls++;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AI_UNAVAILABLE', message: 'Провайдер временно недоступен.', issues: [] } }) });
  });
  await page.getByRole('button', { name: 'Получить AI-анализ' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Провайдер временно недоступен.' })).toBeVisible();
  await page.getByRole('button', { name: 'Повторить AI-анализ' }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByText('56,54', { exact: true }).first()).toBeVisible();
});

test('narrow screen keeps the plan and its primary action usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'План · 0/5' }).click();
  await expect(page.getByRole('heading', { name: 'План для Астаны' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Рассчитать сценарий' })).toBeVisible();
  await page.getByRole('combobox', { name: /Район для районных мер/ }).focus();
  await expect(page.getByRole('combobox', { name: /Район для районных мер/ })).toBeFocused();
});

test('all five zones and map effect states remain available across modes', async ({ page }) => {
  await buildControlPlan(page);
  for (const zone of ['Есиль', 'Алматы + Сарайшык', 'Сарыарка', 'Байконур', 'Нура']) await expect(page.locator('[aria-hidden="true"] button').filter({ has: page.getByText(zone, { exact: true }) })).toBeVisible();
  await expect(page.locator('button[aria-label="M7: Школа и детсад, Нура, запланировано"]')).toBeAttached({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
  await expect(page.getByRole('heading', { name: 'Итог городских решений' })).toBeVisible();
  await page.getByRole('button', { name: 'Город', exact: true }).click();
  await expect(page.locator('button[aria-label="M7: Школа и детсад, Нура, после расчёта"]')).toBeAttached();
  await page.getByRole('button', { name: 'До', exact: true }).click();
  await expect(page.locator('button[aria-label="M7: Школа и детсад, Нура, запланировано"]')).toBeAttached();
  await page.getByRole('button', { name: 'После', exact: true }).click();
  await expect(page.locator('button[aria-label="M7: Школа и детсад, Нура, после расчёта"]')).toBeAttached();
});

test('a timeout message leaves the numeric report available', async ({ page }) => {
  await buildControlPlan(page);
  await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
  await page.route('**/api/analyze', (route) => route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AI_TIMEOUT', message: 'Время ожидания AI истекло.', issues: [] } }) }));
  await page.getByRole('button', { name: 'Получить AI-анализ' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Время ожидания AI истекло.' })).toBeVisible();
  await expect(page.getByText('56,54', { exact: true }).first()).toBeVisible();
});

test('an old simulation response cannot restore a changed plan', async ({ page }) => {
  const scenario = await (await page.request.get('/api/scenario')).json();
  const saved = await (await page.request.post('/api/simulate', { data: { datasetVersion: scenario.datasetVersion, decisions: control } })).json();
  await buildControlPlan(page);
  await page.route('**/api/simulate', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(saved) }); } catch { /* aborted after edit */ }
  });
  await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
  await page.getByRole('button', { name: 'Удалить Перевод частного сектора на чистое топливо' }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Отчёт', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Отчёт появится после расчёта' })).toBeVisible();
});

test('all 14 measures add and remove their map signs in the intended zones', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'План · 0/5' }).click();
  await chooseMenu(page, 'Район для районных мер', 'Нура');
  const scenario = await (await page.request.get('/api/scenario')).json();
  for (const measure of scenario.measures as { id: string; name: string; scope: string }[]) {
    await page.locator('article').filter({ hasText: new RegExp(`^${measure.id} ·`) }).getByRole('button', { name: 'Добавить в план' }).click();
    const signs = page.locator(`button[aria-label^="${measure.id}:"]`);
    await expect(signs).toHaveCount(measure.scope === 'city' ? 5 : 1);
    await page.getByRole('button', { name: `Удалить ${measure.name}` }).click();
    await expect(signs).toHaveCount(0);
  }
});

test('whole-city controls, indicator legend and map attribution are available', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Весь город' })).toBeVisible();
  await expect(page.getByRole('button', { name: '3D центр' })).toBeVisible();
  await chooseMenu(page, 'Слой показателей', 'Разгрузка дорог');
  await expect(page.getByText(/Ниже 40 — критично/)).toBeVisible();
  await expect(page.getByRole('link', { name: /OpenStreetMap contributors/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /OpenFreeMap/ }).first()).toBeVisible();
});

test('map style failure is explained while the decision list remains available', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/styles/liberty*', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: /Не удалось загрузить карту/ })).toBeVisible();
  await page.getByRole('button', { name: 'План · 0/5' }).click();
  await expect(page.getByRole('heading', { name: 'План для Астаны' })).toBeVisible();
});

test('keyboard can choose a district and add a measure', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'План · 0/5' }).click();
  const district = page.getByRole('combobox', { name: /Район для районных мер/ });
  await district.focus();
  await district.press('ArrowDown');
  await district.press('End');
  await district.press('Enter');
  await expect(district).toContainText('Нура');
  const add = page.locator('article').filter({ hasText: /^M7 ·/ }).getByRole('button', { name: 'Добавить в план' });
  await add.focus();
  await add.press('Enter');
  await expect(page.getByRole('button', { name: 'Удалить Школа + детсад (модульное строительство)' })).toBeVisible();
});
