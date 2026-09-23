'use client';

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
const signed = (value: number) => `${value >= 0 ? '+' : '−'}${number(Math.abs(value))}`;

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
      <div><p className={styles.eyebrow}>Астана · горизонт {scenario.horizonQuarters} кварталов</p><h1>Итог городских решений</h1><p>Расчёт по пяти игровым зонам. Показатели модели синтетические.</p></div>
      <div className={styles.score} aria-label={`Итоговый Score ${number(simulation.result.score)} балла`}><span>Astana Quality of Life Score</span><strong>{number(simulation.result.score)}</strong><small>{signed(simulation.scoreDelta)} к исходным {number(simulation.baseline.score)}</small></div>
    </header>

    <ExportReport scenario={scenario} simulation={simulation} analysis={analysis} />

    <section className={styles.stats} aria-label="Основные показатели">
      <Metric label="Потрачено" value={`${number(simulation.cost)} / ${number(scenario.budget)}`} unit="единиц бюджета" />
      <Metric label="Осталось" value={number(simulation.remainingBudget)} unit="единиц бюджета" />
      <Metric label="Средневзвешенный балл" value={number(simulation.result.weightedAverage)} unit="балла" />
      <Metric label="Слабейший район" value={number(simulation.result.minimumDistrictScore)} unit="балла" />
      <Metric label="Критических показателей" value={String(simulation.result.criticalCount)} unit={`ниже ${scenario.rules.criticalThreshold} баллов`} />
    </section>

    {onLoadDecisions && <ComparisonPanel scenario={scenario} simulation={simulation} onLoadDecisions={onLoadDecisions} />}

    {tradeoffMeasure && tradeoffEffect && <section className={styles.tradeoff} aria-label="Проверяемый компромисс решения">
      <div><span className={styles.eyebrow}>Цена и время решения</span><h2>{tradeoffMeasure.name}</h2><p>Район: <strong>{districtNames.get(tradeoffEffect.districtId)}</strong>. Мера стоит <strong>{number(tradeoffMeasure.cost)} ед.</strong> бюджета и начинает действовать через <strong>{tradeoffMeasure.lagQuarters} кв.</strong></p></div>
      <p>За горизонт модели учтено <strong>{number(tradeoffEffect.realizedFraction * 100)}%</strong> полного эффекта на показатель «{indicatorNames.get(tradeoffEffect.indicatorId)}»: <strong>{signed(tradeoffEffect.realizedEffect)} балла</strong>. Это расчётный эффект выбранной меры, а не прогноз реального города.</p>
    </section>}

    <section className={styles.section}><h2>Пять решений</h2><div className={styles.cards}>{simulation.decisions.map((decision, index) => {
      const measure = scenario.measures.find((item) => item.id === decision.measureId);
      return <article className={styles.card} key={decision.measureId}><span className={styles.ordinal}>{String(index + 1).padStart(2, '0')}</span><h3>{measureNames.get(decision.measureId) ?? decision.measureId}</h3><p>{decision.districtId ? districtNames.get(decision.districtId) : 'Весь город'}</p><small>{measure ? `${number(measure.cost)} ед. · эффект через ${measure.lagQuarters} кв.` : ''}</small></article>;
    })}</div></section>

    <section className={styles.section}><h2>Районы и показатели</h2><p>Итог каждого района и все десять показателей до и после решений.</p><div className={styles.districts}>{scenario.districts.map((district) => {
      const b = before.get(district.id); const a = simulation.result.districts.find((item) => item.districtId === district.id);
      if (!b || !a) return null;
      const weakest = simulation.result.weakestDistrictIds.includes(district.id);
      return <article className={styles.district} key={district.id}><div className={styles.districtHeader}><h3>{district.name}{weakest && <span className={styles.warning}> · слабейший район</span>}</h3><strong>{number(b.score)} → {number(a.score)} <small>{signed(a.score - b.score)}</small></strong></div><div className={styles.tableWrap}><table><thead><tr><th scope="col">Показатель</th><th scope="col">До</th><th scope="col">После</th><th scope="col">Изменение</th></tr></thead><tbody>{scenario.indicators.map((indicator) => {
        const oldValue = b.indicators[indicator.id]; const newValue = a.indicators[indicator.id];
        const critical = newValue < scenario.rules.criticalThreshold;
        return <tr key={indicator.id}><th scope="row">{indicator.name} <small>{indicator.id}</small></th><td>{number(oldValue)}</td><td>{number(newValue)}{critical && <span className={styles.warning}> критично</span>}</td><td>{signed(newValue - oldValue)}</td></tr>;
      })}</tbody></table></div></article>;
    })}</div></section>

    <section className={styles.section}><h2>Как получился Score</h2><p>70% средневзвешенного балла + 30% балла слабейшего района − 1 балл за каждый критический показатель.</p><p><strong>{number(simulation.result.weightedAverage)} × 0,70 + {number(simulation.result.minimumDistrictScore)} × 0,30 − {simulation.result.criticalCount} = {number(simulation.result.score)}</strong></p>{simulation.result.criticalIndicators.length > 0 && <p className={styles.warning}>Критические значения: {simulation.result.criticalIndicators.map(({ districtId, indicatorId, value }) => `${districtNames.get(districtId)} · ${indicatorNames.get(indicatorId)} (${number(value)})`).join('; ')}.</p>}</section>

    <section className={styles.section}><h2>Эффекты решений</h2><div className={styles.tableWrap}><table><thead><tr><th scope="col">Решение</th><th scope="col">Район</th><th scope="col">Показатель</th><th scope="col">Полный эффект</th><th scope="col">Учтено за {scenario.horizonQuarters} кв.</th></tr></thead><tbody>{simulation.ledger.measures.map((entry, index) => <tr key={`${entry.measureId}-${entry.districtId}-${entry.indicatorId}-${index}`}><th scope="row">{measureNames.get(entry.measureId)}</th><td>{districtNames.get(entry.districtId)}</td><td>{indicatorNames.get(entry.indicatorId)}</td><td>{signed(entry.fullEffect)}</td><td>{signed(entry.realizedEffect)} ({number(entry.realizedFraction * 100)}%)</td></tr>)}</tbody></table></div>{simulation.ledger.synergies.length > 0 && <div className={styles.synergies}><h3>Синергии</h3>{simulation.ledger.synergies.map((entry) => <p key={`${entry.id}-${entry.districtId}`}>{entry.measureIds.map((id) => measureNames.get(id)).join(' + ')} · {districtNames.get(entry.districtId)}: {Object.entries(entry.effects).map(([id, value]) => `${indicatorNames.get(id as IndicatorId)} ${signed(value ?? 0)}`).join(', ')}</p>)}</div>}{simulation.ledger.indicators.length > 0 && <><h3>Итог по изменённым показателям</h3><div className={styles.tableWrap}><table><thead><tr><th scope="col">Район · показатель</th><th scope="col">Меры</th><th scope="col">Синергия</th><th scope="col">После ограничения 0–100</th></tr></thead><tbody>{simulation.ledger.indicators.map((entry) => <tr key={`${entry.districtId}-${entry.indicatorId}`}><th scope="row">{districtNames.get(entry.districtId)} · {indicatorNames.get(entry.indicatorId)}</th><td>{signed(entry.measureEffect)}</td><td>{signed(entry.synergyEffect)}</td><td>{number(entry.after)} ({signed(entry.delta)})</td></tr>)}</tbody></table></div></>}</section>

    <section className={styles.section} aria-label="AI-анализ результата" aria-live="polite"><h2>AI-анализ результата</h2>{currentAnalysis ? <div className={styles.analysis}><p>{currentAnalysis.analysis.summary.text}</p><FactRefs ids={currentAnalysis.analysis.summary.factIds} facts={facts} /><AnalysisGroup title="Сильные стороны" statements={currentAnalysis.analysis.strengths} facts={facts} /><AnalysisGroup title="Риски" statements={currentAnalysis.analysis.risks} facts={facts} /><AnalysisGroup title="Последствия" statements={currentAnalysis.analysis.consequences} facts={facts} /><h3>Совет</h3><p>{currentAnalysis.analysis.recommendation.text}</p><FactRefs ids={currentAnalysis.analysis.recommendation.factIds} facts={facts} /></div> : <><p>Объяснение будет построено по рассчитанным числам этого сценария.</p>{analysisLoading ? <p role="status">Анализируем сценарий…</p> : analysisError ? <><p role="alert">{analysisError.error.message}</p><button type="button" onClick={onRetryAnalysis}>Повторить AI-анализ</button></> : <button type="button" onClick={onAnalyze}>Получить AI-анализ</button>}</>}</section>
  </main>;
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) { return <article className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{unit}</small></article>; }
function FactRefs({ ids, facts }: { ids: readonly string[]; facts: Map<string, { label: string; value: string | number; unit: string }> }) { const linked = ids.map((id) => facts.get(id)).filter((fact) => fact !== undefined); return linked.length ? <small className={styles.factRefs}>Основание: {linked.map((fact) => `${fact.label} — ${typeof fact.value === 'number' ? number(fact.value) : fact.value} ${fact.unit}`).join('; ')}</small> : null; }
function AnalysisGroup({ title, statements, facts }: { title: string; statements: readonly { text: string; factIds: readonly string[] }[]; facts: Map<string, { label: string; value: string | number; unit: string }> }) { return <div><h3>{title}</h3><ul>{statements.map((statement, index) => <li key={index}>{statement.text}<FactRefs ids={statement.factIds} facts={facts} /></li>)}</ul></div>; }
