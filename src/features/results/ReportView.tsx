'use client';

import { formatBudget, budgetDisclaimer } from '@/lib/budget';
import type { AnalysisState, Decision, IndicatorId, ScenarioResponse, SimulationResponse } from '@/contracts';
import { ExportReport } from '@/features/export/ExportReport';
import { ComparisonPanel } from '@/features/comparison/ComparisonPanel';
import styles from './ReportView.module.css';

export interface ReportViewProps {
  scenario: ScenarioResponse;
  simulation: SimulationResponse | null;
  analysis: AnalysisState;
  onAnalyze: () => void;
  onRetryAnalysis: () => void;
  onLoadDecisions?: (decisions: readonly Decision[]) => void;
}

const number = (value: number) => value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value))}`;

export function ReportView({ scenario, simulation, analysis, onAnalyze, onRetryAnalysis, onLoadDecisions }: ReportViewProps) {
  if (!simulation || simulation.datasetVersion !== scenario.datasetVersion) {
    return <div className={styles.report}><section className={styles.empty} aria-live="polite"><h2>Отчёт появится после расчёта</h2><p>Выберите ровно пять решений и запустите симуляцию.</p></section>{onLoadDecisions && <ComparisonPanel scenario={scenario} simulation={null} onLoadDecisions={onLoadDecisions} />}</div>;
  }

  const districtNames = new Map(scenario.districts.map((district) => [district.id, district.name]));
  const indicatorNames = new Map(scenario.indicators.map((indicator) => [indicator.id, indicator.name]));
  const measureNames = new Map(scenario.measures.map((measure) => [measure.id, measure.name]));
  const before = new Map(simulation.baseline.districts.map((district) => [district.districtId, district]));
  const currentAnalysis = analysis.status === 'success' && analysis.response.scenarioId === simulation.scenarioId && analysis.response.datasetVersion === simulation.datasetVersion ? analysis.response : null;
  const analysisLoading = analysis.status === 'loading' && analysis.scenarioId === simulation.scenarioId;
  const analysisError = analysis.status === 'error' && analysis.scenarioId === simulation.scenarioId ? analysis.error : null;
  const facts = new Map(currentAnalysis?.facts.map((fact) => [fact.id, fact]) ?? []);
  const tradeoffDecision = [...simulation.decisions].filter((decision) => decision.districtId).sort((left, right) => {
    const cost = (id: typeof left.measureId) => scenario.measures.find((measure) => measure.id === id)?.cost ?? 0;
    return cost(right.measureId) - cost(left.measureId);
  })[0] ?? simulation.decisions[0];
  const tradeoffMeasure = scenario.measures.find((measure) => measure.id === tradeoffDecision.measureId);
  const tradeoffEffect = simulation.ledger.measures
    .filter((entry) => entry.measureId === tradeoffDecision.measureId && (!tradeoffDecision.districtId || entry.districtId === tradeoffDecision.districtId))
    .sort((left, right) => Math.abs(right.realizedEffect) - Math.abs(left.realizedEffect))[0];

  return <main className={styles.report}>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>Астана · результат за {scenario.horizonQuarters} кварталов</p><h1>Итог городских решений</h1><p>Один квартал — 3 месяца. Расчёт по пяти игровым зонам. Показатели модели синтетические. {budgetDisclaimer}</p></div>
      <div className={styles.score} aria-label={`Итоговый Score ${number(simulation.result.score)} балла`}><span>Индекс качества жизни · Score</span><strong>{number(simulation.result.score)}</strong><small>Изменение: {signed(simulation.scoreDelta)} балла</small><small>До решений: {number(simulation.baseline.score)} балла</small></div>
    </header>

    <ExportReport scenario={scenario} simulation={simulation} analysis={analysis} />

    <section className={styles.stats} aria-label="Основные показатели">
      <Metric label="Потрачено" value={`${formatBudget(simulation.cost)} / ${formatBudget(scenario.budget)}`} unit="виртуальный бюджет" />
      <Metric label="Осталось" value={formatBudget(simulation.remainingBudget)} unit="виртуальный бюджет" />
      <Metric label="Средний балл города" value={number(simulation.result.weightedAverage)} unit="с учётом веса каждого района" />
      <Metric label="Слабейший район" value={simulation.result.weakestDistrictIds.map((id) => districtNames.get(id)).join(', ')} unit={`${number(simulation.result.minimumDistrictScore)} балла — самый низкий итог района`} />
      <Metric label="Критических показателей" value={String(simulation.result.criticalCount)} unit={`ниже ${scenario.rules.criticalThreshold} баллов`} />
    </section>

    {onLoadDecisions && <ComparisonPanel scenario={scenario} simulation={simulation} onLoadDecisions={onLoadDecisions} />}

    {tradeoffMeasure && tradeoffEffect && <section className={styles.tradeoff} aria-label="Проверяемый компромисс решения">
      <div><span className={styles.eyebrow}>Цена и время решения</span><h2>{tradeoffMeasure.name}</h2><p>Район: <strong>{districtNames.get(tradeoffEffect.districtId)}</strong>. Мера стоит <strong>{formatBudget(tradeoffMeasure.cost)}</strong> бюджета и начинает действовать через <strong>{tradeoffMeasure.lagQuarters} кв.</strong></p></div>
      <p>За горизонт модели учтено <strong>{number(tradeoffEffect.realizedFraction * 100)}%</strong> полного эффекта на показатель «{indicatorNames.get(tradeoffEffect.indicatorId)}»: <strong>{signed(tradeoffEffect.realizedEffect)} балла</strong>. Это расчётный эффект выбранной меры, а не прогноз реального города.</p>
    </section>}

    <section className={styles.section}><h2>Пять решений</h2><div className={styles.cards}>{simulation.decisions.map((decision, index) => {
      const measure = scenario.measures.find((item) => item.id === decision.measureId);
      return <article className={styles.card} key={decision.measureId}><span className={styles.ordinal}>{String(index + 1).padStart(2, '0')}</span><h3>{measureNames.get(decision.measureId) ?? decision.measureId}</h3><p>{decision.districtId ? districtNames.get(decision.districtId) : 'Весь город'}</p><small>{measure ? `${formatBudget(measure.cost)} · эффект через ${measure.lagQuarters} кв.` : ''}</small></article>;
    })}</div></section>

    <section className={styles.section}><h2>Районы и показатели</h2><p>Все десять показателей каждого района — от 0 до 100 баллов. Чем выше, тем лучше. Значение ниже {scenario.rules.criticalThreshold} считается критическим. Изменение «+» означает улучшение, «−» — ухудшение.</p><div className={styles.districts}>{scenario.districts.map((district) => {
      const b = before.get(district.id); const a = simulation.result.districts.find((item) => item.districtId === district.id);
      if (!b || !a) return null;
      const weakest = simulation.result.weakestDistrictIds.includes(district.id);
      return <article className={styles.district} key={district.id}><div className={styles.districtHeader}><h3>{district.name}{weakest && <span className={styles.warning}> · слабейший район</span>}</h3><div className={styles.districtScore}><span>Общий балл района: до → после</span><strong>{number(b.score)} → {number(a.score)} <small>({signed(a.score - b.score)})</small></strong></div></div><div className={styles.tableWrap} role="region" aria-label={`Показатели района ${district.name}`} tabIndex={0}><table className={styles.indicatorTable}><caption>Значения и изменения в баллах</caption><thead><tr><th scope="col">Показатель</th><th scope="col">До</th><th scope="col">После</th><th scope="col">Изменение</th></tr></thead><tbody>{scenario.indicators.map((indicator) => {
        const oldValue = b.indicators[indicator.id]; const newValue = a.indicators[indicator.id];
        const critical = newValue < scenario.rules.criticalThreshold;
        return <tr key={indicator.id}><th scope="row">{indicator.name}</th><td data-label="До">{number(oldValue)}</td><td data-label="После">{number(newValue)}{critical && <span className={styles.criticalTag}>критично</span>}</td><td data-label="Изменение" className={newValue > oldValue ? styles.increase : newValue < oldValue ? styles.decrease : styles.unchanged}>{signed(newValue - oldValue)}</td></tr>;
      })}</tbody></table></div></article>;
    })}</div></section>

    <section className={styles.section}><h2>Как получился Score</h2><p>Индекс качества жизни учитывает средний результат города, положение слабейшего района и критические значения. Чем выше индекс, тем лучше итог.</p><ol className={styles.formulaSteps}><li>70% среднего балла города с учётом веса районов.</li><li>30% балла района с самым низким результатом.</li><li>Минус 1 балл за каждый показатель ниже {scenario.rules.criticalThreshold}.</li></ol><p className={styles.formula}><strong>{number(simulation.result.weightedAverage)} × 0,70 + {number(simulation.result.minimumDistrictScore)} × 0,30 − {simulation.result.criticalCount} = {number(simulation.result.score)}</strong></p>{simulation.result.criticalIndicators.length > 0 && <div className={styles.criticalList}><h3>Критические значения</h3><ul>{simulation.result.criticalIndicators.map(({ districtId, indicatorId, value }) => <li key={`${districtId}-${indicatorId}`}><span>{districtNames.get(districtId)} · {indicatorNames.get(indicatorId)}</span><strong>{number(value)} балла</strong></li>)}</ul></div>}</section>

    <section className={styles.section}><h2>Эффекты решений</h2><p>Полный эффект — изменение показателя при полном действии меры. Учтённый эффект — часть изменения за срок модели с учётом задержки. Все изменения ниже указаны в баллах.</p><p className={styles.scrollHint}>Прокрутите таблицу влево или вправо, чтобы увидеть все столбцы.</p><div className={styles.tableWrap} role="region" aria-label="Эффекты решений по районам" tabIndex={0}><table><caption>Изменения от отдельных решений, без совместных бонусов</caption><thead><tr><th scope="col">Решение</th><th scope="col">Район</th><th scope="col">Показатель</th><th scope="col">Полный эффект</th><th scope="col">Учтено за {scenario.horizonQuarters} кв.</th></tr></thead><tbody>{simulation.ledger.measures.map((entry, index) => <tr key={`${entry.measureId}-${entry.districtId}-${entry.indicatorId}-${index}`}><th scope="row">{measureNames.get(entry.measureId)}</th><td>{districtNames.get(entry.districtId)}</td><td>{indicatorNames.get(entry.indicatorId)}</td><td className={styles.numeric}>{signed(entry.fullEffect)}</td><td className={styles.numeric}>{signed(entry.realizedEffect)}<small className={styles.cellNote}>{number(entry.realizedFraction * 100)}% полного эффекта</small></td></tr>)}</tbody></table></div>{simulation.ledger.synergies.length > 0 && <div className={styles.synergies}><h3>Синергии</h3><p>Дополнительный бонус, когда решения усиливают друг друга.</p>{simulation.ledger.synergies.map((entry) => <p key={`${entry.id}-${entry.districtId}`}>{entry.measureIds.map((id) => measureNames.get(id)).join(' + ')} · {districtNames.get(entry.districtId)}: {Object.entries(entry.effects).map(([id, value]) => `${indicatorNames.get(id as IndicatorId)} ${signed(value ?? 0)}`).join(', ')}</p>)}</div>}{simulation.ledger.indicators.length > 0 && <><h3>Итог по изменённым показателям</h3><div className={styles.tableWrap} role="region" aria-label="Суммарное изменение показателей" tabIndex={0}><table><caption>Баллы от мер и совместных бонусов. Итог показателя ограничен шкалой 0–100.</caption><thead><tr><th scope="col">Район · показатель</th><th scope="col">От решений</th><th scope="col">Совместный бонус</th><th scope="col">Итог показателя</th></tr></thead><tbody>{simulation.ledger.indicators.map((entry) => <tr key={`${entry.districtId}-${entry.indicatorId}`}><th scope="row">{districtNames.get(entry.districtId)} · {indicatorNames.get(entry.indicatorId)}</th><td className={styles.numeric}>{signed(entry.measureEffect)}</td><td className={styles.numeric}>{signed(entry.synergyEffect)}</td><td className={styles.numeric}>{number(entry.after)}<small className={styles.cellNote}>Изменение: {signed(entry.delta)}</small></td></tr>)}</tbody></table></div></>}</section>

    <section className={styles.section} aria-label="AI-анализ результата" aria-live="polite"><h2>AI-анализ результата</h2>{currentAnalysis ? <div className={styles.analysis}><p>{currentAnalysis.analysis.summary.text}</p><FactRefs ids={currentAnalysis.analysis.summary.factIds} facts={facts} /><AnalysisGroup title="Сильные стороны" statements={currentAnalysis.analysis.strengths} facts={facts} /><AnalysisGroup title="Риски" statements={currentAnalysis.analysis.risks} facts={facts} /><AnalysisGroup title="Последствия" statements={currentAnalysis.analysis.consequences} facts={facts} /><h3>Совет</h3><p>{currentAnalysis.analysis.recommendation.text}</p><FactRefs ids={currentAnalysis.analysis.recommendation.factIds} facts={facts} /></div> : <><p>Объяснение будет построено по рассчитанным числам этого сценария.</p>{analysisLoading ? <p role="status">Анализируем сценарий…</p> : analysisError ? <><p role="alert">{analysisError.error.message}</p><button type="button" onClick={onRetryAnalysis}>Повторить AI-анализ</button></> : <button type="button" onClick={onAnalyze}>Получить AI-анализ</button>}</>}</section>
  </main>;
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) { return <article className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{unit}</small></article>; }
function FactRefs({ ids, facts }: { ids: readonly string[]; facts: Map<string, { label: string; value: string | number; unit: string }> }) { const linked = ids.map((id) => facts.get(id)).filter((fact) => fact !== undefined); return linked.length ? <div className={styles.factRefs}><strong>По данным расчёта:</strong>{linked.map((fact, index) => <span key={index}>{fact.label} — <b>{typeof fact.value === 'number' ? number(fact.value) : fact.value} {fact.unit}</b></span>)}</div> : null; }
function AnalysisGroup({ title, statements, facts }: { title: string; statements: readonly { text: string; factIds: readonly string[] }[]; facts: Map<string, { label: string; value: string | number; unit: string }> }) { return <div><h3>{title}</h3><ul>{statements.map((statement, index) => <li key={index}>{statement.text}<FactRefs ids={statement.factIds} facts={facts} /></li>)}</ul></div>; }
