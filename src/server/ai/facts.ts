import type { AnalysisFact, AnalysisInput, Measure, ScenarioResponse, SimulationResponse } from '@/contracts';
import { budgetDisclaimer, toTenge } from '@/lib/budget';

export function buildAnalysisInput(result: SimulationResponse, scenario: ScenarioResponse): AnalysisInput {
  const selectedMeasures = result.decisions.map((decision) => scenario.measures.find((measure) => measure.id === decision.measureId)!);
  const facts: AnalysisFact[] = [
    { id: 'budget-total', label: 'Виртуальный бюджет', value: toTenge(scenario.budget) / 1e9, unit: 'млрд ₸' },
    { id: 'budget-spent', label: 'Потрачено', value: toTenge(result.cost) / 1e9, unit: 'млрд ₸' },
    { id: 'budget-left', label: 'Остаток', value: toTenge(result.remainingBudget) / 1e9, unit: 'млрд ₸' },
    { id: 'horizon', label: 'Горизонт расчёта', value: scenario.horizonQuarters, unit: 'кварталов' },
    { id: 'decision-count', label: 'Выбрано мероприятий', value: result.decisions.length, unit: 'шт.' },
    { id: 'score-before', label: 'Score до', value: result.baseline.score, unit: 'балла' },
    { id: 'score-after', label: 'Score после', value: result.result.score, unit: 'балла' },
    { id: 'score-delta', label: 'Изменение Score', value: result.scoreDelta, unit: 'балла' },
    { id: 'weakest', label: 'Слабейший район', value: result.result.weakestDistrictIds.map((id) => scenario.districts.find((district) => district.id === id)?.name).join(', '), unit: '' },
    { id: 'critical-count', label: 'Критических показателей', value: result.result.criticalCount, unit: 'шт.' },
    { id: 'critical-before', label: 'Критических показателей до', value: result.baseline.criticalCount, unit: 'шт.' },
    { id: 'critical-threshold', label: 'Критический порог (строго ниже)', value: scenario.rules.criticalThreshold, unit: 'балла' },
  ];
  for (const decision of result.decisions) {
    const measure = scenario.measures.find((item) => item.id === decision.measureId)!;
    const place = decision.districtId ? scenario.districts.find((item) => item.id === decision.districtId)!.name : 'весь город';
    const scope = { measureId: measure.id, districtId: decision.districtId };
    facts.push(
      { id: `measure-${measure.id}`, label: `${measure.name} — ${place}`, value: toTenge(measure.cost) / 1e9, unit: 'млрд ₸', ...scope },
      { id: `lag-${measure.id}`, label: `Лаг: ${measure.name} — ${place}`, value: measure.lagQuarters, unit: 'кварталов', ...scope },
    );
    const effect = result.ledger.measures.find((item) => item.measureId === measure.id);
    if (effect) facts.push({ id: `realized-${measure.id}`, label: `Доля эффекта за горизонт: ${measure.name}`, value: effect.realizedFraction * 100, unit: '%', ...scope });
  }
  // Supply useful aggregates explicitly: the language model must not invent or
  // recalculate a district subtotal from unrelated scalar facts.
  for (const districtId of [...new Set(result.decisions.map((decision) => decision.districtId))]) {
    const cost = result.decisions.filter((decision) => decision.districtId === districtId)
      .reduce((sum, decision) => sum + selectedMeasures.find((measure) => measure.id === decision.measureId)!.cost, 0);
    const label = districtId ? `Районные мероприятия: ${scenario.districts.find((district) => district.id === districtId)!.name}` : 'Общегородские мероприятия';
    facts.push({ id: `budget-${districtId ?? 'city'}`, label, value: toTenge(cost) / 1e9, unit: 'млрд ₸', districtId });
  }
  for (const district of result.result.districts) {
    const name = scenario.districts.find((item) => item.id === district.districtId)!.name;
    const before = result.baseline.districts.find((item) => item.districtId === district.districtId)!.score;
    const scope = { districtId: district.districtId, unit: 'балла' };
    facts.push(
      { id: `district-${district.districtId}`, label: `Итог района ${name}`, value: district.score, ...scope },
      { id: `district-before-${district.districtId}`, label: `Баллы района ${name} до`, value: before, ...scope },
      { id: `district-change-${district.districtId}`, label: `Изменение баллов района ${name}`, value: district.score - before, ...scope },
    );
  }
  // Effects are taken from the ledger after lag, before clipping. They are not
  // independent contributions to the nonlinear city Score.
  for (const entry of result.ledger.measures) {
    const measure = selectedMeasures.find((item) => item.id === entry.measureId)!;
    const district = scenario.districts.find((item) => item.id === entry.districtId)!;
    const indicator = scenario.indicators.find((item) => item.id === entry.indicatorId)!;
    facts.push({ id: `effect-${entry.measureId}-${entry.districtId}-${entry.indicatorId}`, label: `Вклад «${measure.name}» в ${indicator.name}, ${district.name} (с учётом лага, до ограничения шкалой)`, value: entry.realizedEffect, unit: 'балла', measureId: entry.measureId, districtId: entry.districtId, indicatorId: entry.indicatorId });
  }
  // Unchanged critical values still explain a scenario's remaining risks.
  for (const entry of result.ledger.indicators.filter((item) => item.delta !== 0 || item.after < scenario.rules.criticalThreshold)) {
    const label = `${scenario.districts.find((item) => item.id === entry.districtId)?.name}: ${scenario.indicators.find((item) => item.id === entry.indicatorId)?.name}`;
    for (const [prefix, value, suffix] of [['change', entry.delta, 'изменение'], ['before', entry.before, 'до'], ['after', entry.after, 'после']] as const) {
      facts.push({ id: `${prefix}-${entry.districtId}-${entry.indicatorId}`, label: `${label} (${suffix})`, value, unit: 'балла', districtId: entry.districtId, indicatorId: entry.indicatorId });
    }
  }
  for (const entry of result.result.criticalIndicators) {
    const district = scenario.districts.find((item) => item.id === entry.districtId)!;
    const indicator = scenario.indicators.find((item) => item.id === entry.indicatorId)!;
    facts.push({ id: `critical-${entry.districtId}-${entry.indicatorId}`, label: `Остаётся критическим: ${district.name}, ${indicator.name}`, value: entry.value, unit: 'балла', districtId: entry.districtId, indicatorId: entry.indicatorId });
  }
  for (const synergy of result.ledger.synergies) {
    const label = `Синергия ${synergy.measureIds.join(' + ')} в районе ${scenario.districts.find((item) => item.id === synergy.districtId)?.name}`;
    facts.push({ id: `synergy-${synergy.id}-${synergy.districtId}`, label, value: Object.entries(synergy.effects).map(([id, value]) => `${id}: +${value}`).join(', '), unit: '', districtId: synergy.districtId });
    for (const indicator of scenario.indicators) {
      const value = synergy.effects[indicator.id];
      if (value !== undefined) facts.push({ id: `synergy-${synergy.id}-${synergy.districtId}-${indicator.id}`, label: `${label}: ${indicator.name}`, value, unit: 'балла', districtId: synergy.districtId, indicatorId: indicator.id });
    }
  }
  return { scenario: result, selectedMeasures: selectedMeasures as Measure[], facts, disclaimer: `Синтетическая учебная модель, не прогноз городской политики. Score вычислен кодом и не должен пересчитываться AI. ${budgetDisclaimer}` };
}
