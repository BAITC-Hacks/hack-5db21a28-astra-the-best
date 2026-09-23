import type { AnalysisFact, AnalysisInput, Measure, ScenarioResponse, SimulationResponse } from '@/contracts';

export function buildAnalysisInput(result: SimulationResponse, scenario: ScenarioResponse): AnalysisInput {
  const selectedMeasures = result.decisions.map((decision) => scenario.measures.find((measure) => measure.id === decision.measureId)!);
  const facts: AnalysisFact[] = [
    { id: 'budget-spent', label: 'Потрачено', value: result.cost, unit: 'ед. бюджета' },
    { id: 'budget-left', label: 'Остаток', value: result.remainingBudget, unit: 'ед. бюджета' },
    { id: 'score-before', label: 'Score до', value: result.baseline.score, unit: 'балла' },
    { id: 'score-after', label: 'Score после', value: result.result.score, unit: 'балла' },
    { id: 'score-delta', label: 'Изменение Score', value: result.scoreDelta, unit: 'балла' },
    { id: 'weakest', label: 'Слабейший район', value: result.result.weakestDistrictIds.map((id) => scenario.districts.find((district) => district.id === id)?.name).join(', '), unit: '' },
    { id: 'critical-count', label: 'Критических показателей', value: result.result.criticalCount, unit: 'шт.' },
  ];
  for (const decision of result.decisions) {
    const measure = scenario.measures.find((item) => item.id === decision.measureId)!;
    facts.push({ id: `measure-${measure.id}`, label: measure.name, value: measure.cost, unit: 'ед. бюджета', measureId: measure.id, districtId: decision.districtId });
  }
  for (const district of result.result.districts) facts.push({ id: `district-${district.districtId}`, label: `Итог района ${scenario.districts.find((item) => item.id === district.districtId)?.name}`, value: district.score, unit: 'балла', districtId: district.districtId });
  for (const entry of result.ledger.indicators.filter((item) => item.delta !== 0)) facts.push({ id: `change-${entry.districtId}-${entry.indicatorId}`, label: `${scenario.districts.find((item) => item.id === entry.districtId)?.name}: ${scenario.indicators.find((item) => item.id === entry.indicatorId)?.name}`, value: entry.delta, unit: 'балла', districtId: entry.districtId, indicatorId: entry.indicatorId });
  for (const synergy of result.ledger.synergies) facts.push({ id: `synergy-${synergy.id}-${synergy.districtId}`, label: `Синергия ${synergy.measureIds.join(' + ')} в районе ${scenario.districts.find((item) => item.id === synergy.districtId)?.name}`, value: Object.entries(synergy.effects).map(([id, value]) => `${id}: +${value}`).join(', '), unit: '', districtId: synergy.districtId });
  return { scenario: result, selectedMeasures: selectedMeasures as Measure[], facts, disclaimer: 'Синтетическая учебная модель, не прогноз городской политики. Score вычислен кодом и не должен пересчитываться AI.' };
}
