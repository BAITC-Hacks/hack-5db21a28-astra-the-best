'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatBudget } from '@/lib/budget';
import type { Decision, ScenarioResponse, SimulationResponse } from '@/contracts';
import { simulate, scenarioId } from '@/domain/simulation';
import { findImprovement } from '@/domain/search/improve';
import { validateScenarioRequest } from '@/domain/validation';
import { COMPARISON_STORAGE_KEY, deleteSavedScenario, readSavedScenarios, saveScenario, type SavedCollection } from './storage';
import styles from './ComparisonPanel.module.css';

export interface ComparisonPanelProps {
  scenario: ScenarioResponse;
  simulation: SimulationResponse | null;
  onLoadDecisions: (decisions: readonly Decision[]) => void;
}
const number = (value: number) => value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value))}`;

export function ComparisonPanel({ scenario, simulation, onLoadDecisions }: ComparisonPanelProps) {
  const [saved, setSaved] = useState<SavedCollection>({ entries: [], warning: null });
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState<ReturnType<typeof findImprovement> | null>(null);
  const current = useMemo(() => {
    if (!simulation) return null;
    const parsed = validateScenarioRequest({ datasetVersion: simulation.datasetVersion, decisions: simulation.decisions }, scenario);
    return parsed.ok ? simulate(parsed.request, scenario) : null;
  }, [scenario, simulation]);
  const comparisons = useMemo(() => saved.entries.flatMap((entry) => {
    if (entry.datasetHash !== scenario.datasetHash || !validateScenarioRequest(entry.request, scenario).ok) return [];
    return [{ entry, result: simulate(entry.request, scenario) }];
  }), [saved, scenario]);
  const activeSearch = search?.baseline.scenarioId === current?.scenarioId ? search : null;
  useEffect(() => {
    const refresh = () => {
      try { setSaved(readSavedScenarios(window.localStorage, scenario)); }
      catch { setSaved({ entries: [], warning: 'Сохранения недоступны в этом браузере.' }); }
    };
    const timer = window.setTimeout(refresh, 0);
    const changed = (event: StorageEvent) => { if (event.key === COMPARISON_STORAGE_KEY || event.key === null) refresh(); };
    window.addEventListener('storage', changed);
    return () => { window.clearTimeout(timer); window.removeEventListener('storage', changed); };
  }, [scenario]);
  const describe = (decision: Decision) => `${scenario.measures.find((measure) => measure.id === decision.measureId)?.name ?? decision.measureId} — ${decision.districtId ? scenario.districts.find((district) => district.id === decision.districtId)?.name : 'весь город'}`;
  const load = (decisions: readonly Decision[]) => {
    if (!validateScenarioRequest({ datasetVersion: scenario.datasetVersion, decisions }, scenario).ok) {
      setMessage('Сценарий больше не соответствует текущим данным.'); return;
    }
    onLoadDecisions(decisions);
    setMessage('Решения перенесены в план. Рассчитайте его, чтобы обновить отчёт.');
  };
  return <section className={styles.panel} aria-label="Сравнение сценариев">
    <header><p className={styles.eyebrow}>Варианты развития</p><h2>Сравните свои решения</h2><p>Сохраните до шести планов в этом браузере. Все числа пересчитываются по одной версии учебной модели.</p></header>
    {current ? <div className={styles.saveRow}>
      <label>Название сценария<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, зелёный город" maxLength={60} /></label>
      <button type="button" onClick={() => {
        try { setSaved(saveScenario(window.localStorage, scenario, current.decisions, name)); setMessage('Сценарий сохранён. Повторное сохранение обновляет его название.'); setName(''); }
        catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось сохранить сценарий.'); }
      }}>Сохранить текущий сценарий</button>
    </div> : <p>Рассчитайте пять решений, чтобы сохранить сценарий и найти улучшение.</p>}
    {saved.warning && <p role="status">{saved.warning}</p>}
    {message && <p role="status">{message}</p>}
    {(current || comparisons.length > 0) && <div className={styles.tableScroll} role="region" aria-label="Таблица сравнения" tabIndex={0}><table>
      <caption>Индекс качества жизни: выше — лучше. Разница показывает, насколько сохранённый план лучше или хуже текущего.</caption>
      <thead><tr><th scope="col">Сценарий</th><th scope="col">Индекс · Score</th><th scope="col">Разница с текущим</th><th scope="col">Потрачено / бюджет</th><th scope="col">Показателей ниже {scenario.rules.criticalThreshold}</th><th scope="col">Действия</th></tr></thead>
      <tbody>
        {current && <tr className={styles.current}><th scope="row">Текущий</th><td>{number(current.result.score)}</td><td>—</td><td>{formatBudget(current.cost)} / {formatBudget(scenario.budget)}</td><td>{current.result.criticalCount}</td><td>На экране</td></tr>}
        {comparisons.map(({ entry, result }) => <tr key={result.scenarioId}>
          <th scope="row">{entry.name}<details><summary>Пять решений</summary><ul>{result.decisions.map((decision) => <li key={decision.measureId}>{describe(decision)}</li>)}</ul></details></th>
          <td>{number(result.result.score)}</td><td>{current ? signed(result.result.score - current.result.score) : '—'}</td><td>{formatBudget(result.cost)} / {formatBudget(scenario.budget)}</td><td>{result.result.criticalCount}</td>
          <td><div className={styles.actions}><button type="button" aria-label={`Открыть ${entry.name}`} onClick={() => load(result.decisions)}>В план</button><button type="button" aria-label={`Удалить ${entry.name}`} onClick={() => {
            try { setSaved(deleteSavedScenario(window.localStorage, scenario, scenarioId(entry.request))); setMessage('Сценарий удалён.'); }
            catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось удалить сценарий.'); }
          }}>Удалить</button></div></td>
        </tr>)}
      </tbody>
    </table></div>}
    {current && <div className={styles.improvement}>
      <h3>Можно ли улучшить одну меру?</h3>
      <p>Проверим, улучшит ли результат замена одного решения или района. Более удачное сочетание нескольких решений может остаться за пределами этой проверки.</p>
      <button type="button" onClick={() => { setSearch(findImprovement({ datasetVersion: scenario.datasetVersion, decisions: current.decisions }, scenario)); }}>Найти проверяемое улучшение</button>
      {activeSearch && <div aria-live="polite">
        <p>Проверено вариантов: {activeSearch.checked}. Соответствуют всем правилам: {activeSearch.validCandidates}.</p>
        {activeSearch.best ? <>
          <p className={styles.gain}>Индекс качества жизни: {number(current.result.score)} → {number(activeSearch.best.simulation.result.score)} <strong>({signed(activeSearch.best.gain)} балла)</strong></p>
          <dl><dt>Вместо</dt><dd>{describe(activeSearch.best.removed)}</dd><dt>Предлагается</dt><dd>{describe(activeSearch.best.added)}</dd></dl>
          <p>Бюджет: {formatBudget(current.cost)} → {formatBudget(activeSearch.best.simulation.cost)} из {formatBudget(scenario.budget)}. Критические показатели: {current.result.criticalCount} → {activeSearch.best.simulation.result.criticalCount}.</p>
          <button type="button" onClick={() => load(activeSearch.best!.simulation.decisions)}>Перенести улучшение в план</button>
        </> : <p>Вариант с более высоким Score при замене одной меры не найден. Другие сочетания пяти мер могут дать иной результат.</p>}
      </div>}
    </div>}
  </section>;
}
