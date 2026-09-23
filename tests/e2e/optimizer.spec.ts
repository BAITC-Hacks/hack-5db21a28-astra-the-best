import { expect, test } from '@playwright/test';
import type { AnalyzeResponse, SimulationResponse } from '../../src/contracts';

test.use({ channel: 'chrome' });
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('hackalem:onboarding:v1', 'dismissed'));
});

function explanation(simulation: SimulationResponse): AnalyzeResponse {
  const statement = { text: 'Проверенное объяснение найденного плана.', factIds: ['score'] };
  return {
    datasetVersion: simulation.datasetVersion, scenarioId: simulation.scenarioId,
    provider: 'test', model: 'test-fixture',
    analysis: { summary: statement, strengths: [statement], risks: [statement], consequences: [statement], recommendation: statement },
    facts: [{ id: 'score', label: 'Score после', value: simulation.result.score, unit: 'баллы' }],
  };
}

test('finds the full optimum, retains the draft on AI failure, retries only AI and applies a valid plan', async ({ page, request }) => {
  const scenario = await (await request.get('/api/scenario')).json();
  const optimumResponse = await request.post('/api/optimize', { data: { datasetVersion: scenario.datasetVersion, datasetHash: scenario.datasetHash } });
  expect(optimumResponse.ok()).toBe(true);
  const optimum = await optimumResponse.json() as { checkedCandidates: number; simulation: SimulationResponse };
  expect(optimum.checkedCandidates).toBe(694395);
  expect(optimum.simulation.result.score).toBeCloseTo(57.236735, 8);
  let searchCalls = 0;
  let analysisCalls = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/optimize') searchCalls++; });
  await page.route('**/api/analyze', async (route) => {
    analysisCalls++;
    expect(route.request().postDataJSON()).toEqual({ datasetVersion: scenario.datasetVersion, decisions: optimum.simulation.decisions });
    if (analysisCalls === 1) await route.fulfill({ status: 503, json: { error: { message: 'ИИ временно недоступен.' } } });
    else await route.fulfill({ json: explanation(optimum.simulation) });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'План · 0/5' }).click();
  const planner = page.getByRole('region', { name: 'Редактор городских решений' });
  const assistant = page.getByRole('region', { name: 'Лучший план с ИИ', exact: true });
  await expect(assistant.getByRole('button', { name: 'Найти лучший план с ИИ' })).toBeVisible();
  expect(searchCalls).toBe(0);
  await assistant.getByRole('button', { name: 'Найти лучший план с ИИ' }).click();
  await expect(assistant.getByText('57,24', { exact: true })).toBeVisible();
  await expect(assistant.getByRole('alert')).toHaveText('ИИ временно недоступен.');
  await expect(planner.getByText('0 / 5 решений', { exact: true })).toBeVisible();
  await expect(assistant.getByRole('button', { name: 'Применить лучший план' })).toBeEnabled();
  await assistant.getByRole('button', { name: 'Повторить объяснение ИИ' }).click();
  await expect(assistant.getByRole('heading', { name: 'Совет ИИ' })).toBeVisible();
  expect(searchCalls).toBe(1);
  expect(analysisCalls).toBe(2);
  await assistant.getByRole('button', { name: 'Применить лучший план' }).click();
  await expect(planner.getByText('5 / 5 решений', { exact: true })).toBeVisible();
  await expect(assistant.getByRole('button', { name: 'Применить лучший план' })).toBeDisabled();
  await planner.getByRole('button', { name: 'Рассчитать сценарий' }).click();
  await expect(page.getByRole('main').getByText('57,24', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Получить AI-анализ' })).toBeVisible();
});

test('mobile preview is readable and can be applied while AI is still loading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  let releaseAnalysis!: () => void;
  const pending = new Promise<void>((resolve) => { releaseAnalysis = resolve; });
  await page.route('**/api/analyze', async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { error: { message: 'Тест задержанного ответа.' } } }).catch(() => {});
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'План · 0/5' }).click();
    const assistant = page.getByRole('region', { name: 'Лучший план с ИИ', exact: true });
    await assistant.getByRole('button', { name: 'Найти лучший план с ИИ' }).click();
    await expect(assistant.getByText('ИИ разбирает найденный план. Его уже можно применить.')).toBeVisible();
    await expect(assistant.getByRole('listitem')).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await assistant.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await assistant.getByRole('button', { name: 'Применить лучший план' }).click();
    await expect(assistant.getByText('Ваш текущий план уже набирает этот максимум.')).toBeVisible();
    await page.getByRole('button', { name: 'Скрыть план' }).click();
    releaseAnalysis();
    await page.getByRole('button', { name: 'План · 5/5' }).click();
    await expect(assistant.getByRole('button', { name: 'Найти лучший план с ИИ' })).toBeEnabled();
    await expect(assistant.getByText('57,24', { exact: true })).toHaveCount(0);
    await expect(assistant.getByRole('alert')).toHaveCount(0);
  } finally { releaseAnalysis(); }
});
