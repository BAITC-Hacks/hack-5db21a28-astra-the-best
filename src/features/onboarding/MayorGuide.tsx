'use client';

import { useEffect, useRef, useState } from 'react';
import { formatBudget, budgetDisclaimer } from '@/lib/budget';
import type { AnalysisState, Decision, DistrictId, IndicatorId, MeasureId, ScenarioResponse, SimulationResponse } from '@/contracts';
import { validateDecisions } from '@/domain/validation';
import { Spotlight, type TourTarget } from './Spotlight';
import styles from './MayorGuide.module.css';

export const ONBOARDING_KEY = 'hackalem:onboarding:v1';
type GuideState = 'hidden' | 'welcome' | 'active';

export function useMayorGuide(ready: boolean) {
  const [state, setState] = useState<GuideState>('hidden');
  const [reportRead, setReportRead] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      try { if (localStorage.getItem(ONBOARDING_KEY)) return; } catch { /* Private browsing still supports the tour. */ }
      setState('welcome');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ready]);
  const dismiss = (completed = false) => {
    try { localStorage.setItem(ONBOARDING_KEY, completed ? 'completed' : 'dismissed'); } catch { /* Storage is optional. */ }
    setState('hidden');
  };
  return {
    state, reportRead,
    restart: () => { setReportRead(false); setState('welcome'); },
    start: () => { setReportRead(false); setState('active'); },
    readReport: () => setReportRead(true),
    dismiss,
  };
}

type Controller = ReturnType<typeof useMayorGuide>;

export function GuideHelp({ onClick }: { onClick: () => void }) {
  return <button type="button" className={styles.help} onClick={onClick}><span aria-hidden="true">?</span> Обучение</button>;
}

export function MayorWelcome({ guide, scenario }: { guide: Controller; scenario: ScenarioResponse }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = guide.state === 'welcome';
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, [open]);
  if (!open) return null;
  return <dialog ref={dialog} className={styles.welcome} aria-labelledby="mayor-welcome-title" onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
    if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
  }} onCancel={(event) => { event.preventDefault(); guide.dismiss(); }}>
    <div className={styles.welcomeTop}><span className={styles.eyebrow}>Ваш первый день · Астана</span><button type="button" className={styles.close} aria-label="Закрыть обучение" onClick={() => guide.dismiss()}>×</button></div>
    <div className={styles.seal} aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="M10 52h44M16 52V28h12v24m8 0V16h12v36M22 28V18m20-2V8M20 35h4m-4 7h4m16-19h4m-4 9h4m-4 9h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></div>
    <h1 id="mayor-welcome-title">Градоначальник,<br />город в ваших руках.</h1>
    <p className={styles.intro}>Вы решаете, что улучшить в Астане. {budgetDisclaimer} Изучите потребности районов, распределите бюджет и узнайте, как ваши решения повлияют на жизнь горожан.</p>
    <div className={styles.brief}>
      <div><strong>{formatBudget(scenario.budget).replace(' ₸', '')}</strong><span>₸ · виртуальный бюджет</span></div>
      <div><strong>{scenario.rules.requiredDecisions}</strong><span>решений в плане</span></div>
      <div><strong>{scenario.horizonQuarters / 4} года</strong><span>горизонт последствий</span></div>
    </div>
    <p className={styles.promise}>Сначала прямо на карте изучим <strong>все десять показателей районов</strong> и научимся их сравнивать. Затем составим план и разберём отчёт. Стрелки покажут, куда смотреть и что нажимать.</p>
    <div className={styles.welcomeActions}><button type="button" className={styles.primary} onClick={guide.start}>Вступить в должность</button><button type="button" className={styles.secondary} onClick={() => guide.dismiss()}>Освоюсь самостоятельно</button></div>
    <p className={styles.footnote}>Это учебная модель с синтетическими показателями, а не прогноз. Обучение можно снова открыть в верхнем меню. Ваш текущий план сохранится.</p>
  </dialog>;
}

interface GuideProps {
  guide: Controller;
  scenario: ScenarioResponse;
  selectedDistrictId: DistrictId | null;
  decisions: readonly Decision[];
  hasResult: boolean;
  analysis: AnalysisState;
  plannerOpen: boolean;
  mode: 'city' | 'report';
  indicatorId?: IndicatorId | null;
  simulation?: SimulationResponse | null;
  comparison?: 'before' | 'after';
}

interface Lesson { key: string; phase: number; title: string; text: string; hint: string; target: TourTarget; next?: string; advance?: () => void; previous?: () => void }

const metricExamples: Record<IndicatorId, { measureId: MeasureId; why: string }> = {
  T1: { measureId: 'M1', why: 'Меньше заторов — лучше. Этот балл уже учитывает направление шкалы: переворачивать его не нужно.' },
  T2: { measureId: 'M1', why: 'Важны доступность остановок и частота транспорта. Это отдельная задача от разгрузки дорог.' },
  E1: { measureId: 'M4', why: 'Показатель описывает обеспеченность зеленью. Баллы — не количество деревьев.' },
  E2: { measureId: 'M5', why: 'Чище воздух — выше балл. Это не само значение AQI, у которого шкала устроена иначе.' },
  S1: { measureId: 'M7', why: 'Смотрите на доступность мест в школах и детсадах, а не только на число зданий.' },
  S2: { measureId: 'M8', why: 'Показывает обеспеченность первичной медицинской помощью. Школа этот показатель не улучшает.' },
  B1: { measureId: 'M10', why: 'Освещение и камеры влияют на безопасность улиц; дорожная безопасность считается отдельно.' },
  B2: { measureId: 'M11', why: 'Безопасные переходы помогают снизить дорожные риски, но одновременно немного ухудшают разгрузку дорог.' },
  C1: { measureId: 'M13', why: 'Это надёжность тепла и воды: меньше аварий — выше качество жизни.' },
  C2: { measureId: 'M12', why: 'Оперативность ответа жителям важна отдельно от состояния сетей. Городская платформа помогает всем районам.' },
};
const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

export function MayorGuide({ guide, scenario, selectedDistrictId, decisions, hasResult, analysis, plannerOpen, mode, indicatorId, simulation, comparison = 'before' }: GuideProps) {
  const [cityRead, setCityRead] = useState(false);
  const [metricStep, setMetricStep] = useState(-1);
  const [budgetRead, setBudgetRead] = useState(false);
  const [scoreRead, setScoreRead] = useState(false);
  const active = guide.state === 'active';
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); guide.dismiss(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [active, guide]);
  if (!active) return null;
  const district = scenario.districts.find((item) => item.id === selectedDistrictId);
  const after = comparison === 'after' && simulation?.datasetVersion === scenario.datasetVersion ? simulation.result : null;
  const valuesFor = (id: DistrictId) => after?.districts.find((item) => item.districtId === id)?.indicators ?? scenario.districts.find((item) => item.id === id)!.indicators;
  const required = scenario.rules.requiredDecisions;
  const planButton: TourTarget = { selector: 'nav button', text: `План · ${decisions.length}/5` };
  const reportButton: TourTarget = { selector: 'nav button', text: 'Отчёт' };
  const preferred = ['M7', 'M8', 'M10', 'M12', 'M5'];
  const measures = [...scenario.measures].sort((a, b) => {
    const rank = (id: string) => preferred.includes(id) ? preferred.indexOf(id) : 100;
    return rank(a.id) - rank(b.id);
  });
  const suggested = measures.find((measure) => {
    if (decisions.some((decision) => decision.measureId === measure.id)) return false;
    const decision: Decision = measure.scope === 'city' ? { measureId: measure.id } : { measureId: measure.id, ...(selectedDistrictId ? { districtId: selectedDistrictId } : {}) };
    return validateDecisions([...decisions, decision], { mode: 'draft', scenario }).valid;
  });
  let lesson: Lesson;
  if (!cityRead && mode !== 'city') {
    lesson = { key: 'back-city', phase: 1, title: 'Начнём с показателей города', text: 'Сначала разберём, как живут районы и что означают их показатели. Затем перейдём к плану и отчёту.', hint: 'Нажмите «Город»', target: { selector: 'nav button', text: 'Город' } };
  } else if (!cityRead && plannerOpen) {
    lesson = { key: 'close-plan', phase: 1, title: 'Сначала изучим город', text: 'Закройте панель плана, чтобы увидеть показатели на карте. Ваши решения сохранятся.', hint: 'Нажмите «Скрыть план»', target: { selector: 'nav button', text: 'Скрыть план' } };
  } else if (!cityRead && !district && metricStep < scenario.indicators.length) {
    lesson = { key: 'district', phase: 1, title: 'Начнём с жителей Нуры', text: 'Нажмите «Нура». Откроется карточка района, и мы последовательно разберём все десять показателей. Можно выбрать и другой район.', hint: 'Нажмите на название района', target: { selector: '[data-guide-zone="nura"]' } };
  } else if (!cityRead && district && metricStep < 0) {
    const critical = scenario.indicators.filter((item) => valuesFor(district.id)[item.id] < scenario.rules.criticalThreshold);
    lesson = { key: `district-facts-${district.id}`, phase: 1, title: `${district.name}: узнайте потребности`, text: `Здесь десять показателей по пяти направлениям, каждый от 0 до 100. Больше — всегда лучше. Сейчас ${critical.length ? `ниже 40: ${critical.map((item) => item.name.toLowerCase()).join(', ')}` : 'нет показателей ниже 40'}. За каждый показатель строго ниже 40 общий Score теряет один балл.`, hint: after ? 'Показаны значения после ваших решений' : 'Показаны исходные значения района', target: { selector: '[aria-label^="Показатели района"] h2' }, next: 'Изучить показатели', advance: () => setMetricStep(0) };
  } else if (!cityRead && district && metricStep < scenario.indicators.length) {
    const indicator = scenario.indicators[metricStep];
    const value = valuesFor(district.id)[indicator.id];
    const example = metricExamples[indicator.id];
    const measure = scenario.measures.find((item) => item.id === example.measureId)!;
    const full = measure.effects[indicator.id] ?? 0;
    const realized = full * (scenario.horizonQuarters - measure.lagQuarters) / scenario.horizonQuarters;
    const status = value < scenario.rules.criticalThreshold ? 'Это критическое значение: ниже 40.' : value === scenario.rules.criticalThreshold ? 'Ровно 40 — граница, штрафа за этот показатель нет.' : 'Штрафа нет, но показатель ещё можно улучшать.';
    lesson = { key: `metric-${district.id}-${indicator.id}`, phase: 1, title: indicator.name, text: `${district.name}: ${number(value)} из 100. ${indicator.description} ${status} ${example.why} Например, «${measure.name}»: полный эффект +${number(full)}, с задержкой ${measure.lagQuarters} кв. учитывается +${number(realized)} за два года (до ограничения шкалой 100).`, hint: `Показатель ${metricStep + 1} из ${scenario.indicators.length} · ${scenario.directions.find((item) => item.id === indicator.directionId)!.name}`, target: { selector: `[data-guide-indicator="${indicator.id}"]` }, next: metricStep === scenario.indicators.length - 1 ? 'Сравнить районы' : 'Следующий показатель', advance: () => setMetricStep((step) => step + 1), previous: () => setMetricStep((step) => step - 1) };
  } else if (!cityRead && district) {
    lesson = { key: 'close-district-card', phase: 1, title: 'Теперь посмотрим на весь город', text: 'Вы изучили показатели района. Закройте его карточку, чтобы открыть список слоёв и сравнить районы. Ваш план и рассчитанные результаты сохранятся.', hint: 'Нажмите «Закрыть» в карточке района', target: { selector: '[aria-label^="Показатели района"] header button' }, previous: () => setMetricStep(scenario.indicators.length - 1) };
  } else if (!cityRead && indicatorId !== 'S1') {
    lesson = { key: 'select-map-layer', phase: 1, title: 'Включите слой школ и детсадов', text: 'Откройте «Слой показателей» и выберите «Школы и детсады». Карта окрасит районы по этому показателю, а рядом с названиями появятся точные значения.', hint: 'Выберите «Школы и детсады» в списке', target: { selector: '[aria-label="Игровые зоны"] [role="combobox"]' }, previous: () => setMetricStep(scenario.indicators.length - 1) };
  } else if (!cityRead) {
    const ranked = [...scenario.districts].sort((a, b) => valuesFor(a.id).S1 - valuesFor(b.id).S1);
    const weakest = ranked[0];
    const strongest = ranked.at(-1)!;
    lesson = { key: `compare-map-layer-${district?.id}`, phase: 1, title: 'Сравните районы по одному показателю', text: `Школы и детсады: ${weakest.name} — ${number(valuesFor(weakest.id).S1)}, ${strongest.name} — ${number(valuesFor(strongest.id).S1)}. Цвет помогает найти проблему, цифры показывают её масштаб. Score учитывает и средний результат города (70%), и самый слабый район (30%), а также штрафы за значения ниже 40. Теперь выберем, кому и чем помочь.`, hint: 'Сравнивайте один и тот же показатель во всех районах', target: { selector: `[data-guide-zone="${weakest.id}"] strong` }, next: 'Понятно, составим план', advance: () => setCityRead(true), previous: () => setMetricStep(scenario.indicators.length - 1) };
  } else if (hasResult && mode !== 'report') {
    lesson = { key: 'open-report', phase: 5, title: 'Откройте результат ваших решений', text: 'Нажмите «Отчёт» в верхнем меню. Ваш план и положение карты сохранятся.', hint: 'Нажмите подсвеченную кнопку', target: reportButton };
  } else if (hasResult && !scoreRead) {
    lesson = { key: 'score', phase: 5, title: 'Вот результат вашей работы', text: 'Score — общий балл качества жизни. Под ним показано, насколько он изменился относительно исходного города. Чем выше балл, тем лучше.', hint: 'Сравните итоговый балл и изменение под ним', target: { selector: '[aria-label^="Итоговый Score"] strong' }, next: 'А кому стало лучше?', advance: () => setScoreRead(true) };
  } else if (hasResult && !guide.reportRead) {
    lesson = { key: 'district-result', phase: 5, title: 'Общий рост — ещё не вся картина', text: 'Проверьте слабейший район и критические показатели ниже 40. Далее в отчёте — все значения до и после, эффекты мер и синергии. В городе можно сравнить карту кнопками «До / После».', hint: 'Эти показатели помогают заметить нерешённые проблемы', target: { selector: '[aria-label="Основные показатели"] article:nth-child(4) strong' }, next: 'Перейти к ИИ-разбору', advance: guide.readReport };
  } else if (hasResult && analysis.status === 'success') {
    lesson = { key: 'complete', phase: 6, title: 'Вы освоили управление городом', text: 'У выводов ИИ есть ссылки на факты. Сопоставьте совет с числами и решите, что изменить. Через «План» можно пересобрать решения и рассчитать новый результат.', hint: 'Решение за вами, градоначальник', target: { selector: '[aria-label="AI-анализ результата"] h2' }, next: 'Начать управлять самостоятельно', advance: () => guide.dismiss(true) };
  } else if (hasResult) {
    const failed = analysis.status === 'error';
    const loading = analysis.status === 'loading';
    lesson = { key: `ai-${analysis.status}`, phase: 6, title: failed ? 'ИИ не ответил. Ваш расчёт сохранён' : loading ? 'ИИ разбирает ваш план' : 'Попросите совет у ИИ', text: failed ? 'Попробуйте ещё раз этой кнопкой или завершите обучение. Ошибка ИИ не меняет показатели города.' : loading ? 'Сейчас появятся сильные стороны, риски и совет. Числа отчёта уже рассчитаны и доступны.' : 'Нажмите эту кнопку. ИИ объяснит плюсы, риски и компромиссы ваших решений на основе рассчитанных фактов.', hint: loading ? 'Дождитесь ответа или завершите обучение' : 'Нажмите подсвеченную кнопку', target: { selector: loading ? '[aria-label="AI-анализ результата"] [role="status"]' : '[aria-label="AI-анализ результата"] button', ...(loading ? {} : { text: failed ? 'Повторить AI-анализ' : 'Получить AI-анализ' }) }, next: 'Завершить без ИИ', advance: () => guide.dismiss(true) };
  } else if (mode !== 'city') {
    lesson = { key: 'back-city', phase: 1, title: 'Сначала подготовим ваш план', text: 'Нажмите «Город». Отчёт появится после выбора пяти решений и расчёта.', hint: 'Нажмите подсвеченную кнопку', target: { selector: 'nav button', text: 'Город' } };
  } else if (!district && !plannerOpen) {
    lesson = { key: 'district', phase: 1, title: 'Начнём с жителей Нуры', text: 'Нажмите «Нура». Откроются показатели района. В учебном примере начнём с его потребностей; вы можете выбрать и другой район.', hint: 'Нажмите сюда — на название района', target: { selector: '[data-guide-zone="nura"]' } };
  } else if (!district && plannerOpen) {
    lesson = { key: 'planner-district', phase: 1, title: 'Укажите, какому району помочь', text: 'Откройте этот список и выберите район. Городские меры будут действовать сразу во всех районах.', hint: 'Выберите район в подсвеченном списке', target: { selector: '[aria-label="Редактор городских решений"] [role="combobox"]' } };
  } else if (!plannerOpen) {
    lesson = { key: 'open-plan', phase: 2, title: 'Теперь откройте вашу панель решений', text: 'Нажмите «План» справа вверху. Здесь вы распределяете бюджет и выбираете мероприятия.', hint: 'Нажмите подсвеченную кнопку в меню', target: planButton };
  } else if (decisions.length > 0 && !budgetRead) {
    lesson = { key: 'budget', phase: 3, title: 'Первое решение уже в плане', text: `Здесь видно, сколько из ${formatBudget(scenario.budget)} уже потрачено. Нужно ровно ${required} решений: не более двух на направление и минимум три направления. Все деньги тратить необязательно.`, hint: 'Бюджет проверяется при каждом добавлении', target: { selector: '[aria-label="Использованный бюджет"]' }, next: 'Добавить следующее решение', advance: () => setBudgetRead(true) };
  } else if (decisions.length >= required) {
    lesson = { key: 'calculate', phase: 4, title: 'Узнайте, что изменится в городе', text: 'Нажмите «Рассчитать сценарий». Вы увидите последствия за два условных года, изменение качества жизни и результат по районам.', hint: 'Нажмите подсвеченную кнопку', target: { selector: '[aria-label="Редактор городских решений"] footer button' } };
  } else if (suggested) {
    lesson = { key: `measure-${suggested.id}-${decisions.length}`, phase: decisions.length ? 3 : 2, title: decisions.length ? `Решение ${decisions.length + 1} из ${required}` : 'Добавьте ваше первое решение', text: `Для знакомства предлагаем «${suggested.name}»: ${formatBudget(suggested.cost)}, эффект через ${suggested.lagQuarters} кв. Квартал — три месяца. Плюсы и минусы видны в карточке. Можно выбрать другую доступную меру.`, hint: 'Нажмите «Добавить в план» в этой карточке', target: { selector: '[aria-label="Каталог мероприятий"] article button', measureId: suggested.id } };
  } else {
    lesson = { key: 'revise', phase: 3, title: 'Освободите место для следующего решения', text: 'Сейчас добавить меру мешают бюджет или ограничения. Удалите либо замените одну из выбранных мер. Причины запрета указаны под карточками.', hint: 'Пересмотрите одно из решений', target: { selector: '[aria-label="Редактор городских решений"] button[aria-label^="Удалить "]' } };
  }
  return <Spotlight key={lesson.key} target={lesson.target} stepKey={lesson.key}>
    <div className={styles.tourTop}><span className={styles.eyebrow}>Ваш первый день · {lesson.phase} / 6</span><button type="button" className={styles.close} aria-label="Закрыть обучение" onClick={() => guide.dismiss()}>×</button></div>
    <h2 aria-live="polite">{lesson.title}</h2>
    <p id="mayor-tour-description">{lesson.text}</p>
    <div className={styles.clickHint}><span aria-hidden="true">↗</span>{lesson.hint}</div>
    <div className={styles.tourFooter}><button type="button" className={styles.skip} onClick={() => guide.dismiss()}>Пропустить обучение</button>{lesson.previous && <button type="button" className={styles.secondary} onClick={lesson.previous}>Назад</button>}{lesson.next && <button type="button" className={styles.primary} onClick={lesson.advance}>{lesson.next}</button>}</div>
  </Spotlight>;
}
