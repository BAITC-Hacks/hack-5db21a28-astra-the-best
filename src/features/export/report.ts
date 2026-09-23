import { budgetDisclaimer, formatBudget, toTenge, TENGE_PER_BUDGET_UNIT } from '@/lib/budget';
import type { AnalysisState, AnalyzeResponse, ScenarioResponse, SimulationResponse } from '@/contracts';
import { simulate } from '@/domain/simulation';
import { buildAnalysisInput } from '@/server/ai/facts';

export interface ReportExportInput {
  scenario: ScenarioResponse;
  simulation: SimulationResponse;
  analysis: AnalysisState;
}

export const exportDisclaimer = 'Синтетическая учебная модель пяти игровых зон Астаны. Горизонт — два условных года (8 кварталов). Это не прогноз реальной городской политики.';

/** Reject stale or modified results before producing a portable report. */
export function prepareReport({ scenario, simulation, analysis }: ReportExportInput) {
  const verified = simulate({ datasetVersion: simulation.datasetVersion, decisions: simulation.decisions }, scenario);
  if (JSON.stringify(verified) !== JSON.stringify(simulation)) throw new Error('Результат изменился. Рассчитайте текущий сценарий перед экспортом.');
  const expectedFacts = buildAnalysisInput(verified, scenario).facts;
  let currentAnalysis: AnalyzeResponse | null = null;
  if (analysis.status === 'success') {
    const response = analysis.response;
    const statements = [response.analysis.summary, ...response.analysis.strengths, ...response.analysis.risks, ...response.analysis.consequences, response.analysis.recommendation];
    const validFacts = response.facts.length === expectedFacts.length && expectedFacts.every((fact) => {
      const actual = response.facts.find((item) => item.id === fact.id);
      return actual && Object.entries(fact).every(([key, value]) => actual[key as keyof typeof actual] === value);
    });
    if (response.scenarioId === verified.scenarioId && response.datasetVersion === verified.datasetVersion && validFacts && statements.every((item) => item.text.trim() && item.factIds.length > 0 && item.factIds.every((id) => expectedFacts.some((fact) => fact.id === id)))) {
      currentAnalysis = response;
    }
  }
  return {
    formatVersion: 1,
    disclaimer: `${exportDisclaimer} ${budgetDisclaimer}`,
    money: { currency: 'KZT', tengePerBudgetUnit: TENGE_PER_BUDGET_UNIT, budgetTenge: toTenge(scenario.budget), spentTenge: toTenge(verified.cost), remainingTenge: toTenge(verified.remainingBudget) },
    datasetVersion: scenario.datasetVersion,
    datasetHash: scenario.datasetHash,
    horizonQuarters: scenario.horizonQuarters,
    simulation: verified,
    decisions: verified.decisions.map((decision) => {
      const measure = scenario.measures.find((item) => item.id === decision.measureId)!;
      return { ...decision, name: measure.name, district: decision.districtId ? scenario.districts.find((item) => item.id === decision.districtId)!.name : 'Весь город', cost: measure.cost, costTenge: toTenge(measure.cost), lagQuarters: measure.lagQuarters };
    }),
    analysis: currentAnalysis,
  };
}

const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const number = (value: number) => value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildReportJson(input: ReportExportInput): string {
  return JSON.stringify(prepareReport(input), null, 2);
}

export function buildReportHtml(input: ReportExportInput): string {
  const report = prepareReport(input);
  const result = report.simulation;
  const { scenario } = input;
  const districtName = (id: string) => scenario.districts.find((district) => district.id === id)?.name ?? id;
  const decisions = report.decisions.map((item, index) => `<tr><td>${index + 1}</td><th scope="row">${escapeHtml(item.name)}</th><td>${escapeHtml(item.district)}</td><td>${formatBudget(item.cost)}</td><td>${item.lagQuarters} кв.</td></tr>`).join('');
  const districts = result.result.districts.map((district) => {
    const before = result.baseline.districts.find((item) => item.districtId === district.districtId)!;
    return `<tr><th scope="row">${escapeHtml(districtName(district.districtId))}</th><td>${number(before.score)}</td><td>${number(district.score)}</td><td>${number(district.score - before.score)}</td></tr>`;
  }).join('');
  const ai = report.analysis;
  const statement = (item: NonNullable<typeof ai>['analysis']['summary']) => `<p>${escapeHtml(item.text)}</p><p class="source">Основание: ${item.factIds.map((id) => {
    const fact = ai!.facts.find((entry) => entry.id === id)!;
    return `${escapeHtml(fact.label)} — ${escapeHtml(typeof fact.value === 'number' ? number(fact.value) : fact.value)} ${escapeHtml(fact.unit)}`;
  }).join('; ')}</p>`;
  const analysisHtml = ai ? `${statement(ai.analysis.summary)}${([['Сильные стороны', ai.analysis.strengths], ['Риски', ai.analysis.risks], ['Последствия', ai.analysis.consequences]] as const).map(([title, items]) => `<h3>${title}</h3>${items.map(statement).join('')}`).join('')}<h3>Совет</h3>${statement(ai.analysis.recommendation)}<p class="source">${escapeHtml(ai.provider)} · ${escapeHtml(ai.model)}. Числа и ссылки проверены по этому расчёту; объяснение AI требует критической оценки.</p>` : '<p>Проверенный AI-анализ для этого сценария отсутствует и не включён в экспорт. Математический результат рассчитан кодом.</p>';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Астана — отчёт о городских решениях</title><style>
*{box-sizing:border-box}body{margin:0;color:#202630;background:#eceef1;font:16px/1.55 system-ui,sans-serif}main{max-width:960px;margin:32px auto;background:white;padding:clamp(20px,5vw,56px);border-radius:24px}h1{font-size:clamp(26px,5vw,40px);line-height:1.2}h2{margin-top:32px;font-size:23px}h3{font-size:18px}p{overflow-wrap:anywhere}.lead,.source,footer{color:#52606d}.source{font-size:13px}.score{font-size:44px;font-weight:750;margin:12px 0}.stats{display:flex;gap:24px;flex-wrap:wrap}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px 8px;border-bottom:1px solid #d9dfe6;text-align:left;overflow-wrap:anywhere}thead{background:#f2f4f6}footer{border-top:1px solid #d9dfe6;padding-top:20px;margin-top:32px;font-size:12px}.hint{padding:12px 16px;background:#f2f4f6;border-radius:12px}@media print{@page{size:A4;margin:16mm}body{background:white;font-size:11pt}main{margin:0;padding:0;max-width:none;border-radius:0}.hint{display:none}h2,h3{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}.score{font-size:30pt}}@media(max-width:480px){td,th{padding:8px 4px;font-size:12px}}
</style></head><body><main><p class="lead">Астана · городской симулятор · ${report.horizonQuarters} кварталов</p><h1>Итог пяти решений</h1><p>${escapeHtml(report.disclaimer)}</p><p class="hint">Чтобы сохранить PDF, откройте печать браузера (Ctrl+P / ⌘P) и выберите «Сохранить как PDF».</p>
<section><h2>Astana Quality of Life Score</h2><p class="score">${number(result.result.score)}</p><p>До: ${number(result.baseline.score)} · изменение: ${number(result.scoreDelta)}</p><p class="source">Точное значение Score без округления: ${result.result.score}</p><div class="stats"><p>Потрачено <strong>${formatBudget(result.cost)} / ${formatBudget(scenario.budget)}</strong></p><p>Осталось <strong>${formatBudget(result.remainingBudget)}</strong></p><p>Критических показателей <strong>${result.result.criticalCount}</strong></p></div><p>Слабейший район: ${escapeHtml(result.result.weakestDistrictIds.map(districtName).join(', '))} (${number(result.result.minimumDistrictScore)}).</p><p class="source">Score = ${scenario.rules.averageWeight} × средневзвешенный балл + ${scenario.rules.minimumWeight} × балл слабейшего района − ${scenario.rules.criticalPenalty} × число показателей ниже ${scenario.rules.criticalThreshold}.</p></section>
<section><h2>Пять решений</h2><table><thead><tr><th>№</th><th>Решение</th><th>Где</th><th>Стоимость</th><th>Лаг</th></tr></thead><tbody>${decisions}</tbody></table></section>
<section><h2>Районы: до и после</h2><table><thead><tr><th>Район</th><th>До</th><th>После</th><th>Изменение</th></tr></thead><tbody>${districts}</tbody></table></section>
<section><h2>AI-анализ текущего сценария</h2>${analysisHtml}</section><footer><p>Версия данных: ${escapeHtml(report.datasetVersion)} · хеш: ${escapeHtml(report.datasetHash)}</p><p>Сценарий: ${escapeHtml(result.scenarioId)}</p><p>Для точных чисел всех показателей и эффектов используйте JSON-экспорт того же сценария.</p></footer></main></body></html>`;
}
