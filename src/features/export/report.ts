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
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value))}`;

export function buildReportJson(input: ReportExportInput): string {
  return JSON.stringify(prepareReport(input), null, 2);
}

export function buildReportHtml(input: ReportExportInput): string {
  const report = prepareReport(input);
  const result = report.simulation;
  const { scenario } = input;
  const districtName = (id: string) => scenario.districts.find((district) => district.id === id)?.name ?? id;
  const decisions = report.decisions.map((item, index) => `<tr><td>${index + 1}</td><th scope="row">${escapeHtml(item.name)}</th><td>${escapeHtml(item.district)}</td><td class="numeric">${formatBudget(item.cost)}</td><td>${item.lagQuarters === 0 ? 'Сразу' : `Через ${item.lagQuarters * 3} мес.`}</td></tr>`).join('');
  const districts = result.result.districts.map((district) => {
    const before = result.baseline.districts.find((item) => item.districtId === district.districtId)!;
    return `<tr><th scope="row">${escapeHtml(districtName(district.districtId))}</th><td class="numeric">${number(before.score)}</td><td class="numeric">${number(district.score)}</td><td class="numeric">${signed(district.score - before.score)}</td></tr>`;
  }).join('');
  const ai = report.analysis;
  const statement = (item: NonNullable<typeof ai>['analysis']['summary']) => `<p>${escapeHtml(item.text)}</p><p class="source">Основание: ${item.factIds.map((id) => {
    const fact = ai!.facts.find((entry) => entry.id === id)!;
    return `${escapeHtml(fact.label)} — ${escapeHtml(typeof fact.value === 'number' ? number(fact.value) : fact.value)} ${escapeHtml(fact.unit)}`;
  }).join('; ')}</p>`;
  const analysisHtml = ai ? `${statement(ai.analysis.summary)}${([['Сильные стороны', ai.analysis.strengths], ['Риски', ai.analysis.risks], ['Последствия', ai.analysis.consequences]] as const).map(([title, items]) => `<h3>${title}</h3>${items.map(statement).join('')}`).join('')}<h3>Совет</h3>${statement(ai.analysis.recommendation)}<p class="source">${escapeHtml(ai.provider)} · ${escapeHtml(ai.model)}. Числа и ссылки проверены по этому расчёту; объяснение AI требует критической оценки.</p>` : '<p>Проверенный AI-анализ для этого сценария отсутствует и не включён в экспорт. Математический результат рассчитан кодом.</p>';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Астана — отчёт о городских решениях</title><style>
*{box-sizing:border-box}body{margin:0;color:#202630;background:#eceef1;font:16px/1.65 system-ui,sans-serif}main{max-width:960px;margin:32px auto;background:white;padding:clamp(20px,5vw,56px);border-radius:24px;min-width:0}h1{font-size:clamp(26px,5vw,40px);line-height:1.2}h2{margin-top:32px;font-size:23px}h3{font-size:18px}p{max-width:80ch}.lead,.source,footer{color:#52606d}.source{font-size:14px;line-height:1.6}.score{font-size:44px;font-weight:750;margin:12px 0;font-variant-numeric:tabular-nums}.stats{display:flex;gap:20px;flex-wrap:wrap}.stats p{padding:14px 18px;background:#f2f4f6;border-radius:12px}.stats strong{display:block}.table-scroll{overflow-x:auto;border:1px solid #d9dfe6;border-radius:12px;max-width:100%}table{border-collapse:collapse;width:100%;min-width:600px;font-size:15px}td,th{padding:14px 12px;border-bottom:1px solid #d9dfe6;text-align:left;vertical-align:top;line-height:1.5}tbody th{font-weight:550;min-width:160px}caption{text-align:left;padding:12px;font-size:14px;color:#52606d;background:#f2f4f6}thead{background:#f2f4f6}tbody tr:nth-child(even){background:#fafbfc}.numeric{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}footer{border-top:1px solid #d9dfe6;padding-top:20px;margin-top:32px;font-size:14px;overflow-wrap:anywhere}.hint,.scroll-hint{padding:12px 16px;background:#f2f4f6;border-radius:12px}.scroll-hint{display:none;font-size:14px}@media(max-width:600px){main{margin:0;border-radius:0}.scroll-hint{display:block}.stats{gap:8px}.stats p{width:100%;margin:4px 0}}@media print{@page{size:A4;margin:16mm}body{background:white;font-size:11pt}main{margin:0;padding:0;max-width:none;border-radius:0}.hint,.scroll-hint{display:none}.table-scroll{overflow:visible;border:0}table{min-width:0;font-size:10pt}td,th{padding:8px}h2,h3{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}.score{font-size:30pt}}
</style></head><body><main><p class="lead">Астана · городской симулятор · ${report.horizonQuarters} кварталов</p><h1>Итог пяти решений</h1><p>${escapeHtml(report.disclaimer)}</p><p class="hint">Чтобы сохранить PDF, откройте печать браузера (Ctrl+P / ⌘P) и выберите «Сохранить как PDF».</p>
<section><h2>Индекс качества жизни · Score</h2><p class="score">${number(result.result.score)}</p><p>До решений: ${number(result.baseline.score)} балла. Изменение: ${signed(result.scoreDelta)} балла.</p><p class="source">Точное значение Score без округления: ${result.result.score}</p><div class="stats"><p>Потрачено <strong>${formatBudget(result.cost)} / ${formatBudget(scenario.budget)}</strong></p><p>Осталось <strong>${formatBudget(result.remainingBudget)}</strong></p><p>Критических показателей <strong>${result.result.criticalCount}</strong></p></div><p>Слабейший район: ${escapeHtml(result.result.weakestDistrictIds.map(districtName).join(', '))} — ${number(result.result.minimumDistrictScore)} балла.</p><p>Как рассчитан индекс: ${number(scenario.rules.averageWeight * 100)}% среднего балла с учётом веса районов + ${number(scenario.rules.minimumWeight * 100)}% балла слабейшего района − ${scenario.rules.criticalPenalty} балл за каждый показатель ниже ${scenario.rules.criticalThreshold}. Чем выше индекс, тем лучше итог.</p></section>
<section><h2>Пять решений</h2><p class="scroll-hint">Прокрутите таблицу влево или вправо, чтобы увидеть все данные.</p><div class="table-scroll" role="region" aria-label="Стоимость и сроки решений" tabindex="0"><table><thead><tr><th>№</th><th>Решение</th><th>Где действует</th><th>Стоимость</th><th>Начало эффекта</th></tr></thead><tbody>${decisions}</tbody></table></div></section>
<section><h2>Районы: до и после</h2><p>Общий балл каждого района. Положительное изменение означает улучшение.</p><p class="scroll-hint">Таблицу можно прокручивать влево и вправо.</p><div class="table-scroll" role="region" aria-label="Результаты районов" tabindex="0"><table><caption>Все значения и изменения указаны в баллах</caption><thead><tr><th>Район</th><th>До решений</th><th>После решений</th><th>Изменение</th></tr></thead><tbody>${districts}</tbody></table></div></section>
<section><h2>AI-анализ текущего сценария</h2>${analysisHtml}</section><footer><p>Версия данных: ${escapeHtml(report.datasetVersion)} · хеш: ${escapeHtml(report.datasetHash)}</p><p>Сценарий: ${escapeHtml(result.scenarioId)}</p><p>Для точных чисел всех показателей и эффектов используйте JSON-экспорт того же сценария.</p></footer></main></body></html>`;
}
