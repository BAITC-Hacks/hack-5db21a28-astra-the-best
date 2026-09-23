'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AnalysisState, Decision, DistrictId, ErrorResponse, MeasureId, ScenarioResponse, SimulationResponse } from '@/contracts';
import { CityMap } from '@/features/city-map/CityMap';
import { CityEffects } from '@/features/city-effects/CityEffects';
import { Planner } from '@/features/planner/Planner';
import { ReportView } from '@/features/results/ReportView';
import styles from './AppShell.module.css';

type Mode = 'city' | 'report';

export function AppShell() {
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState(true);
  const [decisions, setDecisions] = useState<readonly Decision[]>([]);
  const [selectedDistrictId, setSelectedDistrictId] = useState<DistrictId | null>(null);
  const [selectedMeasureId, setSelectedMeasureId] = useState<MeasureId | null>(null);
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'idle' });
  const [comparison, setComparison] = useState<'before' | 'after'>('after');
  const [mode, setMode] = useState<Mode>('city');
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const mapStageRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const simulateAbort = useRef<AbortController | null>(null);
  const analyzeAbort = useRef<AbortController | null>(null);

  const loadScenario = useCallback(async () => {
    try {
      const response = await fetch('/api/scenario', { cache: 'no-store' });
      setScenarioError(null);
      if (!response.ok) throw new Error('Не удалось загрузить сценарий.');
      const loaded = await response.json() as ScenarioResponse;
      setScenario((previous) => {
        if (previous && previous.datasetVersion !== loaded.datasetVersion) { setDecisions([]); setResult(null); setAnalysis({ status: 'idle' }); }
        return loaded;
      });
    } catch { setScenarioError('Не удалось загрузить данные сценария. Проверьте подключение и повторите.'); }
    finally { setScenarioLoading(false); }
  }, []);

  useEffect(() => { const start = window.setTimeout(() => { void loadScenario(); }, 0); return () => { window.clearTimeout(start); simulateAbort.current?.abort(); analyzeAbort.current?.abort(); }; }, [loadScenario]);
  useEffect(() => { if (mode === 'city') map?.resize(); }, [mode, map]);
  useEffect(() => {
    const root = mapStageRef.current;
    if (!root || !plannerOpen) return;
    const previous = new Map<HTMLElement, string | null>();
    const removeFromTabOrder = () => {
      root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex], div').forEach((element) => {
        const scrollable = element.tagName === 'DIV' && element.scrollHeight > element.clientHeight && /auto|scroll/.test(getComputedStyle(element).overflowY);
        if (!element.matches('button, a[href], input, select, textarea, [tabindex]') && !scrollable) return;
        if (!previous.has(element)) previous.set(element, element.getAttribute('tabindex'));
        if (element.getAttribute('tabindex') !== '-1') element.setAttribute('tabindex', '-1');
      });
    };
    removeFromTabOrder();
    const observer = new MutationObserver(removeFromTabOrder);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex'] });
    return () => {
      observer.disconnect();
      previous.forEach((tabIndex, element) => {
        if (tabIndex === null) element.removeAttribute('tabindex');
        else element.setAttribute('tabindex', tabIndex);
      });
    };
  }, [plannerOpen, scenario]);

  const changeDecisions = (next: readonly Decision[]) => {
    generation.current++;
    simulateAbort.current?.abort(); analyzeAbort.current?.abort();
    setDecisions(next); setResult(null); setAnalysis({ status: 'idle' }); setError(null); setCalculating(false);
  };

  const calculate = async () => {
    if (!scenario || calculating) return;
    const current = ++generation.current;
    const controller = new AbortController();
    simulateAbort.current?.abort(); simulateAbort.current = controller;
    setCalculating(true); setError(null);
    try {
      const response = await fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetVersion: scenario.datasetVersion, decisions }), signal: controller.signal });
      const body = await response.json() as SimulationResponse | ErrorResponse;
      if (current !== generation.current) return;
      if (!response.ok) {
        if (response.status === 409) void loadScenario();
        throw new Error('error' in body ? body.error.message : 'Не удалось рассчитать сценарий.');
      }
      const computed = body as SimulationResponse;
      if (computed.datasetVersion !== scenario.datasetVersion) return;
      setResult(computed); setAnalysis({ status: 'idle' }); setComparison('after'); setPlannerOpen(false); setMode('report');
    } catch (cause) {
      if (current === generation.current && !(cause instanceof Error && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Не удалось рассчитать сценарий.');
    } finally { if (current === generation.current) setCalculating(false); }
  };

  const analyze = async () => {
    if (!scenario || !result) return;
    const current = generation.current;
    const currentId = result.scenarioId;
    const controller = new AbortController();
    analyzeAbort.current?.abort(); analyzeAbort.current = controller;
    setAnalysis({ status: 'loading', scenarioId: currentId });
    try {
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetVersion: scenario.datasetVersion, decisions }), signal: controller.signal });
      const body = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) { setAnalysis({ status: 'error', scenarioId: currentId, error: body as ErrorResponse }); return; }
      if (body.scenarioId === currentId && body.datasetVersion === scenario.datasetVersion) setAnalysis({ status: 'success', response: body });
    } catch (cause) {
      if (current !== generation.current || (cause instanceof Error && cause.name === 'AbortError')) return;
      setAnalysis({ status: 'error', scenarioId: currentId, error: { error: { code: 'AI_UNAVAILABLE', message: 'Не удалось получить AI-анализ. Попробуйте ещё раз.', issues: [] } } });
    }
  };

  const preview = scenario && selectedMeasureId ? (() => {
    const measure = scenario.measures.find((item) => item.id === selectedMeasureId);
    if (!measure) return null;
    return measure.scope === 'city' ? { measureId: measure.id } : selectedDistrictId ? { measureId: measure.id, districtId: selectedDistrictId } : null;
  })() : null;

  return <div className={styles.app}>
    <nav className={styles.nav} aria-label="Режим отображения"><div className={styles.brand}>Аким <strong>на 5 часов</strong></div><div className={styles.mode}><button type="button" aria-pressed={mode === 'city'} onClick={() => setMode('city')}>Город</button><button type="button" aria-pressed={mode === 'report'} onClick={() => setMode('report')}>Отчёт</button></div><button type="button" className={styles.planToggle} onClick={() => { setMode('city'); setPlannerOpen((open) => !open); }}>{plannerOpen ? 'Скрыть план' : `План · ${decisions.length}/5`}</button></nav>
    {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => setError(null)}>Закрыть</button></div>}
    <div className={mode === 'city' ? styles.cityVisible : styles.cityHidden}>
      {scenario ? <div ref={mapStageRef} className={styles.mapStage} aria-hidden={plannerOpen}><CityMap scenario={scenario} result={result} comparison={comparison} selectedDistrictId={selectedDistrictId} onDistrictSelect={setSelectedDistrictId} onMapReady={setMap} /><CityEffects map={map} scenario={scenario} decisions={decisions} preview={preview} result={result} comparison={comparison} /></div> : <div className={styles.loading}>{scenarioLoading ? 'Загружаем город…' : <>{scenarioError}<button type="button" onClick={() => { setScenarioLoading(true); void loadScenario(); }}>Повторить</button></>}</div>}
      {result && !plannerOpen && <div className={styles.compare} aria-label="Сравнение карты"><button type="button" aria-pressed={comparison === 'before'} onClick={() => setComparison('before')}>До</button><button type="button" aria-pressed={comparison === 'after'} onClick={() => setComparison('after')}>После</button></div>}
      {plannerOpen && <div className={styles.planner}><Planner scenario={scenario} decisions={decisions} selectedDistrictId={selectedDistrictId} onDistrictSelect={setSelectedDistrictId} onDecisionsChange={changeDecisions} onCalculate={() => void calculate()} onMeasureSelect={setSelectedMeasureId} loading={scenarioLoading} error={scenarioError} onRetry={() => void loadScenario()} calculating={calculating} /></div>}
    </div>
    {mode === 'report' && (scenario ? <ReportView scenario={scenario} simulation={result} analysis={analysis} onAnalyze={() => void analyze()} onRetryAnalysis={() => void analyze()} /> : <div className={styles.loading}>{scenarioLoading ? 'Загружаем отчёт…' : scenarioError}</div>)}
  </div>;
}
