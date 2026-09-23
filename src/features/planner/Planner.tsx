'use client';

import { useState } from 'react';
import type { Decision, DirectionId, DistrictId, Measure, MeasureId, ScenarioResponse } from '@/contracts';
import { validateDecisions } from '@/domain/validation';
import styles from './Planner.module.css';

export interface PlannerProps {
  scenario: ScenarioResponse | null;
  decisions: readonly Decision[];
  selectedDistrictId: DistrictId | null;
  onDistrictSelect: (id: DistrictId) => void;
  onDecisionsChange: (decisions: readonly Decision[]) => void;
  onCalculate: () => void;
  onMeasureSelect?: (id: MeasureId | null) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  calculating?: boolean;
}

const signed = (value: number) => `${value > 0 ? '+' : '−'}${Math.abs(value)}`;

export function Planner({ scenario, decisions, selectedDistrictId, onDistrictSelect, onDecisionsChange, onCalculate, onMeasureSelect, loading = false, error, onRetry, calculating = false }: PlannerProps) {
  const [direction, setDirection] = useState<DirectionId | 'all'>('all');
  const [replacement, setReplacement] = useState<MeasureId | null>(null);
  const [focused, setFocused] = useState<MeasureId | null>(null);

  if (!scenario) return <section className={styles.state} aria-live="polite"><h2>План города</h2>{loading ? <p role="status">Загружаем данные сценария…</p> : <><p role="alert">{error || 'Не удалось загрузить данные сценария.'}</p>{onRetry && <button type="button" onClick={onRetry}>Повторить загрузку</button>}</>}</section>;

  const validation = validateDecisions(decisions, { mode: 'draft', scenario });
  const finalValidation = validateDecisions(decisions, { mode: 'final', scenario });
  const districtNames = new Map(scenario.districts.map((item) => [item.id, item.name]));
  const measureNames = new Map(scenario.measures.map((item) => [item.id, item.name]));
  const indicatorNames = new Map(scenario.indicators.map((item) => [item.id, item.name]));
  const directionNames = new Map(scenario.directions.map((item) => [item.id, item.name]));
  const chosen = new Set(decisions.map((item) => item.measureId));
  const visible = direction === 'all' ? scenario.measures : scenario.measures.filter((item) => item.directionId === direction);

  function candidate(measure: Measure) {
    const next: Decision = measure.scope === 'city' ? { measureId: measure.id } : { measureId: measure.id, ...(selectedDistrictId ? { districtId: selectedDistrictId } : {}) };
    const proposed = [...decisions];
    const replacementIndex = replacement ? proposed.findIndex((item) => item.measureId === replacement) : -1;
    if (replacementIndex >= 0) proposed.splice(replacementIndex, 1, next);
    else proposed.push(next);
    const checked = validateDecisions(proposed, { mode: 'draft', scenario: scenario! });
    const reason = chosen.has(measure.id) && replacement !== measure.id ? 'Мера уже выбрана.' : measure.scope === 'district' && !selectedDistrictId ? 'Сначала выберите район.' : checked.issues.map((issue) => issue.message).join(' ');
    return { proposed, reason };
  }

  function setFocus(id: MeasureId | null) {
    setFocused(id);
    onMeasureSelect?.(id);
  }

  return <section className={styles.planner} aria-label="Редактор городских решений">
    <header className={styles.header}><div><span className={styles.kicker}>Панель акима · два условных года</span><h2>План для Астаны</h2><p>Синтетическая учебная модель. Выберите ровно пять мероприятий.</p></div><div className={styles.budget}><strong>{validation.remainingBudget} / {scenario.budget}</strong><span>Остаток бюджета</span><small>{decisions.length} / {scenario.rules.requiredDecisions} решений</small></div></header>
    <div className={styles.budgetBar} role="progressbar" aria-label="Использованный бюджет" aria-valuenow={validation.cost} aria-valuemin={0} aria-valuemax={scenario.budget}><span style={{ width: `${Math.min(100, Math.max(0, validation.cost))}%` }} /></div>
    <div className={styles.directions} aria-label="Меры по направлениям">{scenario.directions.map((item) => <span key={item.id}>{item.name}: {validation.directionCounts[item.id]}/{scenario.rules.maxPerDirection}</span>)}</div>
    <section className={styles.plan}><div className={styles.sectionTitle}><h3>Ваши решения</h3>{replacement && <button type="button" onClick={() => setReplacement(null)}>Отменить замену</button>}</div><ol className={styles.slots}>{Array.from({ length: scenario.rules.requiredDecisions }, (_, index) => {
      const decision = decisions[index];
      if (!decision) return <li className={styles.emptySlot} key={`empty-${index}`}>Решение {index + 1} · свободно</li>;
      const measure = scenario.measures.find((item) => item.id === decision.measureId);
      return <li className={`${styles.slot} ${replacement === decision.measureId ? styles.replacing : ''}`} key={decision.measureId}><div><strong>{measureNames.get(decision.measureId)}</strong><small>{decision.districtId ? districtNames.get(decision.districtId) : 'Весь город'} · {measure?.cost} ед.</small></div><div className={styles.slotActions}><button type="button" aria-label={`Заменить ${measureNames.get(decision.measureId)}`} onClick={() => setReplacement(decision.measureId)}>Заменить</button><button type="button" aria-label={`Удалить ${measureNames.get(decision.measureId)}`} onClick={() => { onDecisionsChange(decisions.filter((item) => item.measureId !== decision.measureId)); if (replacement === decision.measureId) setReplacement(null); }}>Удалить</button></div></li>;
    })}</ol>{replacement && <p className={styles.hint}>Выберите новую меру в каталоге. Она займёт место «{measureNames.get(replacement)}».</p>}</section>
    <div className={styles.controls}><label>Район для районных мер<select value={selectedDistrictId ?? ''} onChange={(event) => onDistrictSelect(event.target.value as DistrictId)}><option value="">Выберите район</option>{scenario.districts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Направление<select value={direction} onChange={(event) => setDirection(event.target.value as DirectionId | 'all')}><option value="all">Все направления</option>{scenario.directions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div>
    <div className={styles.catalog} aria-label="Каталог мероприятий">{visible.map((measure) => {
      const { proposed, reason } = candidate(measure);
      const fraction = (scenario.horizonQuarters - measure.lagQuarters) / scenario.horizonQuarters;
      return <article className={`${styles.card} ${focused === measure.id ? styles.focused : ''}`} key={measure.id} onMouseEnter={() => setFocus(measure.id)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(measure.id)}><div className={styles.cardTop}><span>{measure.id} · {directionNames.get(measure.directionId)}</span><strong>{measure.cost} ед.</strong></div><h4>{measure.name}</h4><p className={styles.scope}>{measure.scope === 'city' ? 'Весь город' : selectedDistrictId ? `Район: ${districtNames.get(selectedDistrictId)}` : 'Нужен район'} · эффект через {measure.lagQuarters} кв. · учтено {Math.round(fraction * 100)}%</p><ul className={styles.effects}>{Object.entries(measure.effects).map(([id, value]) => <li className={value! < 0 ? styles.negative : styles.positive} key={id}>{indicatorNames.get(id as keyof typeof measure.effects) ?? id} {signed(value!)}</li>)}</ul><button type="button" disabled={Boolean(reason)} onClick={() => { onDecisionsChange(proposed); setReplacement(null); }}>{replacement ? 'Заменить мерой' : 'Добавить в план'}</button>{reason && <p className={styles.reason}>{reason}</p>}</article>;
    })}</div>
    <details className={styles.baseline}><summary>Исходные показатели пяти районов</summary><div className={styles.baselineGrid}>{scenario.districts.map((district) => <article key={district.id}><h4>{district.name}</h4><p>{district.profile}</p><dl>{scenario.indicators.map((indicator) => <div key={indicator.id}><dt>{indicator.name}</dt><dd>{district.indicators[indicator.id]} {indicator.unit}</dd></div>)}</dl></article>)}</div></details>
    <footer className={styles.footer} aria-live="polite"><p>{finalValidation.valid ? 'План готов к расчёту.' : validation.issues.length ? validation.issues.map((issue) => issue.message).join(' ') : `Добавьте ещё ${scenario.rules.requiredDecisions - decisions.length} ${scenario.rules.requiredDecisions - decisions.length === 1 ? 'решение' : 'решения'}.`}</p><button type="button" disabled={!finalValidation.valid || calculating} onClick={onCalculate}>{calculating ? 'Рассчитываем…' : 'Рассчитать сценарий'}</button></footer>
  </section>;
}
