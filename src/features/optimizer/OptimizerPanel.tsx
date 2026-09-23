'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisFact, AnalysisStatement, AnalyzeResponse, Decision, ScenarioResponse } from '@/contracts';
import { simulate } from '@/domain/simulation';
import { validateScenarioRequest } from '@/domain/validation';
import { formatBudget } from '@/lib/budget';
import { scoreColor } from '@/features/city-map/score-colors';
import { postJson, readAnalysis, readCandidate, type OptimizerResult } from './responses';
import styles from './OptimizerPanel.module.css';

export interface OptimizerPanelProps {
  scenario: ScenarioResponse;
  decisions: readonly Decision[];
  onApply: (decisions: readonly Decision[]) => void;
  disabled?: boolean;
}

type Analysis = { status: 'idle' | 'loading' } | { status: 'success'; response: AnalyzeResponse } | { status: 'error'; message: string };
const number = (value: number) => value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value))}`;

export function OptimizerPanel(props: OptimizerPanelProps) {
  // A dataset change synchronously hides old results and cleans up both requests.
  return <OptimizerSession key={JSON.stringify([props.scenario.datasetVersion, props.scenario.datasetHash])} {...props} />;
}

function OptimizerSession({ scenario, decisions, onApply, disabled = false }: OptimizerPanelProps) {
  const [candidate, setCandidate] = useState<OptimizerResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [analysis, setAnalysis] = useState<Analysis>({ status: 'idle' });
  const [applied, setApplied] = useState(false);
  const lifecycle = useRef({ active: true, generation: 0 });
  const searchRequest = useRef<AbortController | null>(null);
  const analysisRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const session = lifecycle.current;
    session.active = true;
    return () => {
      session.active = false;
      session.generation++;
      searchRequest.current?.abort();
      analysisRequest.current?.abort();
    };
  }, []);

  const current = useMemo(() => {
    const validated = validateScenarioRequest({ datasetVersion: scenario.datasetVersion, decisions }, scenario);
    return validated.ok ? simulate(validated.request, scenario) : null;
  }, [scenario, decisions]);
  const matchesDraft = Boolean(candidate && current?.scenarioId === candidate.simulation.scenarioId);
  const active = (generation: number) => lifecycle.current.active && lifecycle.current.generation === generation;

  async function explain(result: OptimizerResult, generation: number) {
    if (!active(generation) || analysisRequest.current) return;
    const controller = new AbortController();
    analysisRequest.current = controller;
    setAnalysis({ status: 'loading' });
    try {
      const body = await postJson('/api/analyze', { datasetVersion: result.datasetVersion, decisions: result.simulation.decisions }, controller.signal);
      if (!active(generation) || controller.signal.aborted) return;
      setAnalysis({ status: 'success', response: readAnalysis(body, result.simulation) });
    } catch (error) {
      if (active(generation) && !controller.signal.aborted) setAnalysis({ status: 'error', message: error instanceof Error ? error.message : 'ИИ пока недоступен. Попробуйте ещё раз.' });
    } finally {
      if (analysisRequest.current === controller) analysisRequest.current = null;
    }
  }

  async function search() {
    if (disabled || searchRequest.current || analysisRequest.current) return;
    const generation = ++lifecycle.current.generation;
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setSearchError('');
    setCandidate(null);
    setAnalysis({ status: 'idle' });
    setApplied(false);
    try {
      const body = await postJson('/api/optimize', { datasetVersion: scenario.datasetVersion, datasetHash: scenario.datasetHash }, controller.signal);
      if (!active(generation) || controller.signal.aborted) return;
      const result = readCandidate(body, scenario);
      setCandidate(result);
      setSearching(false);
      // The explicit search-with-AI action authorizes this explanation; mounting never does.
      void explain(result, generation);
    } catch (error) {
      if (active(generation) && !controller.signal.aborted) setSearchError(error instanceof Error ? error.message : 'Не удалось найти план. Попробуйте ещё раз.');
    } finally {
      if (searchRequest.current === controller) searchRequest.current = null;
      if (active(generation)) setSearching(false);
    }
  }

  return <section className={styles.panel} aria-label="Лучший план с ИИ">
    <div className={styles.intro}><span className={styles.kicker}>Помощник мэра</span><h3>Как набрать максимум Score?</h3><p>Найдём лучшее сочетание пяти мер и районов в рамках бюджета. ИИ объяснит результат и его компромиссы.</p></div>
    <button type="button" className={styles.primary} onClick={() => { void search(); }} disabled={disabled || searching || analysis.status === 'loading'}>Найти лучший план с ИИ</button>
    {searching && <p className={styles.status} role="status">Сравниваем допустимые планы и ищем максимальный Score…</p>}
    {searchError && <p className={styles.error} role="alert">{searchError}</p>}
    {candidate && <div className={styles.result}>
      <div className={styles.score} role="status"><span>Максимальный Score в этой модели</span><strong style={{ color: scoreColor(candidate.simulation.result.score, 'text') }}>{number(candidate.simulation.result.score)}</strong><span>{signed(candidate.simulation.scoreDelta)} балла к исходному городу</span></div>
      {current && <p className={styles.comparison}>{matchesDraft ? 'Ваш текущий план уже набирает этот максимум.' : <>К вашему текущему плану: <strong>{signed(candidate.simulation.result.score - current.result.score)} балла</strong>.</>}</p>}
      <dl className={styles.budget}><div><dt>Стоимость плана</dt><dd>{formatBudget(candidate.simulation.cost)}</dd></div><div><dt>Останется</dt><dd>{formatBudget(candidate.simulation.remainingBudget)}</dd></div></dl>
      <h4>Пять решений для лучшего результата</h4>
      <ol className={styles.measures}>{candidate.simulation.decisions.map((decision) => {
        const measure = scenario.measures.find((item) => item.id === decision.measureId)!;
        const district = decision.districtId ? scenario.districts.find((item) => item.id === decision.districtId)?.name : 'Весь город';
        return <li key={decision.measureId}><strong>{measure.name}</strong><span>{district} · {formatBudget(measure.cost)}</span></li>;
      })}</ol>
      <p className={styles.proof}>Проверены все допустимые варианты: <strong>{candidate.checkedCandidates.toLocaleString('ru-RU')}</strong>. При равном Score выбран более дешёвый план.</p>
      <p className={styles.caveat}>Это максимум общего Score за два условных года в учебной модели. Отдельные показатели могут ухудшиться; данные и эффекты синтетические.</p>
      <button type="button" className={styles.primary} disabled={disabled || matchesDraft} onClick={() => {
        if (disabled || matchesDraft) return;
        onApply(candidate.simulation.decisions.map((decision) => ({ ...decision })));
        setApplied(true);
      }}>Применить лучший план</button>
      <p className={styles.applyNote}>{applied && matchesDraft ? 'Пять решений перенесены в план. Рассчитайте сценарий, чтобы обновить отчёт.' : 'Кнопка заменит все решения в вашем текущем плане. Затем рассчитайте сценарий для отчёта.'}</p>
      <section className={styles.analysis} aria-label="Объяснение ИИ лучшего плана">
        <h4>Почему этот план набирает больше</h4>
        {analysis.status === 'loading' && <p role="status">ИИ разбирает найденный план. Его уже можно применить.</p>}
        {analysis.status === 'error' && <><p className={styles.error} role="alert">{analysis.message}</p><p>Найденный план и его Score сохранены.</p><button type="button" className={styles.secondary} disabled={disabled} onClick={() => { if (!disabled) void explain(candidate, lifecycle.current.generation); }}>Повторить объяснение ИИ</button></>}
        {analysis.status === 'success' && <AnalysisDetails response={analysis.response} />}
      </section>
    </div>}
  </section>;
}

function AnalysisDetails({ response }: { response: AnalyzeResponse }) {
  const facts = new Map(response.facts.map((fact) => [fact.id, fact]));
  return <div className={styles.analysisText}>
    <Statement statement={response.analysis.summary} facts={facts} />
    {([{ title: 'Сильные стороны', statements: response.analysis.strengths }, { title: 'Риски', statements: response.analysis.risks }, { title: 'Последствия', statements: response.analysis.consequences }, { title: 'Совет ИИ', statements: [response.analysis.recommendation] }]).map((group) => <div key={group.title}><h5>{group.title}</h5>{group.statements.map((statement, index) => <Statement key={index} statement={statement} facts={facts} />)}</div>)}
  </div>;
}

function Statement({ statement, facts }: { statement: AnalysisStatement; facts: Map<string, AnalysisFact> }) {
  const linked = statement.factIds.flatMap((id) => facts.has(id) ? [facts.get(id)!] : []);
  return <div><p>{statement.text}</p>{linked.length > 0 && <details className={styles.facts}><summary>Данные расчёта</summary><ul>{linked.map((fact) => <li key={fact.id}>{fact.label}: <strong style={isAbsoluteMetricFact(fact) ? { color: scoreColor(fact.value as number, 'text') } : undefined}>{typeof fact.value === 'number' ? number(fact.value) : fact.value} {fact.unit}</strong></li>)}</ul></details>}</div>;
}

function isAbsoluteMetricFact(fact: AnalysisFact): boolean {
  return typeof fact.value === 'number' && (fact.id === 'score-before' || fact.id === 'score-after' || (fact.id.startsWith('district-') && !fact.id.startsWith('district-change-')) || fact.id.startsWith('before-') || fact.id.startsWith('after-'));
}
