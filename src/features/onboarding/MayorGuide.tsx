'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnalysisState, Decision, DistrictId, ScenarioResponse } from '@/contracts';
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
    <p className={styles.intro}>Вы решаете, что улучшить в Астане. Изучите потребности районов, распределите бюджет и узнайте, как ваши решения повлияют на жизнь горожан.</p>
    <div className={styles.brief}>
      <div><strong>{scenario.budget}</strong><span>единиц бюджета</span></div>
      <div><strong>{scenario.rules.requiredDecisions}</strong><span>решений в плане</span></div>
      <div><strong>{scenario.horizonQuarters / 4} года</strong><span>горизонт последствий</span></div>
    </div>
    <p className={styles.promise}>Пройдём путь вместе: <strong>район → решение → результат.</strong> Подсказки будут меняться по мере ваших действий.</p>
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
}

interface Lesson { key: string; phase: number; title: string; text: string; hint: string; target: TourTarget; next?: string; advance?: () => void }

export function MayorGuide({ guide, scenario, selectedDistrictId, decisions, hasResult, analysis, plannerOpen, mode }: GuideProps) {
  const [districtRead, setDistrictRead] = useState(false);
  const [budgetRead, setBudgetRead] = useState(false);
  const [scoreRead, setScoreRead] = useState(false);
  const active = guide.state === 'active';
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); guide.dismiss(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [active, guide]);
  if (!active) return null;
  const district = scenario.districts.find((item) => item.id === selectedDistrictId);
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
  if (hasResult && mode !== 'report') {
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
    lesson = { key: 'district', phase: 1, title: 'Начнём с жителей Нуры', text: 'Нажмите «Нура». Откроются показатели района. В учебном примере начнём с его потребностей; вы можете выбрать и другой район.', hint: 'Нажмите сюда — на название района', target: { selector: '[aria-label="Игровые зоны"] button', text: 'Нура' } };
  } else if (!district && plannerOpen) {
    lesson = { key: 'planner-district', phase: 1, title: 'Укажите, какому району помочь', text: 'Откройте этот список и выберите район. Городские меры будут действовать сразу во всех районах.', hint: 'Выберите район в подсвеченном списке', target: { selector: '[aria-label="Редактор городских решений"] [role="combobox"]' } };
  } else if (!districtRead && !plannerOpen && decisions.length === 0) {
    lesson = { key: 'district-facts', phase: 1, title: `${district?.name}: узнайте потребности`, text: 'В карточке района — условия жизни по десяти показателям. Чем выше число, тем лучше. Ниже 40 — критичная проблема. «Слой показателей» позволяет сравнивать районы на карте.', hint: 'Посмотрите показатели под названием района', target: { selector: '[aria-label="3D-карта Астаны"] h2' }, next: 'Понятно, составим план', advance: () => setDistrictRead(true) };
  } else if (!plannerOpen) {
    lesson = { key: 'open-plan', phase: 2, title: 'Теперь откройте вашу панель решений', text: 'Нажмите «План» справа вверху. Здесь вы распределяете бюджет и выбираете мероприятия.', hint: 'Нажмите подсвеченную кнопку в меню', target: planButton };
  } else if (decisions.length > 0 && !budgetRead) {
    lesson = { key: 'budget', phase: 3, title: 'Первое решение уже в плане', text: `Здесь видно, сколько из ${scenario.budget} единиц уже потрачено. Нужно ровно ${required} решений: не более двух на направление и минимум три направления. Все деньги тратить необязательно.`, hint: 'Бюджет проверяется при каждом добавлении', target: { selector: '[aria-label="Использованный бюджет"]' }, next: 'Добавить следующее решение', advance: () => setBudgetRead(true) };
  } else if (decisions.length >= required) {
    lesson = { key: 'calculate', phase: 4, title: 'Узнайте, что изменится в городе', text: 'Нажмите «Рассчитать сценарий». Вы увидите последствия за два условных года, изменение качества жизни и результат по районам.', hint: 'Нажмите подсвеченную кнопку', target: { selector: '[aria-label="Редактор городских решений"] footer button' } };
  } else if (suggested) {
    lesson = { key: `measure-${suggested.id}-${decisions.length}`, phase: decisions.length ? 3 : 2, title: decisions.length ? `Решение ${decisions.length + 1} из ${required}` : 'Добавьте ваше первое решение', text: `Для знакомства предлагаем «${suggested.name}»: ${suggested.cost} ед., эффект через ${suggested.lagQuarters} кв. Квартал — три месяца. Плюсы и минусы видны в карточке. Можно выбрать другую доступную меру.`, hint: 'Нажмите «Добавить в план» в этой карточке', target: { selector: '[aria-label="Каталог мероприятий"] article button', measureId: suggested.id } };
  } else {
    lesson = { key: 'revise', phase: 3, title: 'Освободите место для следующего решения', text: 'Сейчас добавить меру мешают бюджет или ограничения. Удалите либо замените одну из выбранных мер. Причины запрета указаны под карточками.', hint: 'Пересмотрите одно из решений', target: { selector: '[aria-label="Редактор городских решений"] button[aria-label^="Удалить "]' } };
  }
  return <Spotlight key={lesson.key} target={lesson.target} stepKey={lesson.key}>
    <div className={styles.tourTop}><span className={styles.eyebrow}>Ваш первый день · {lesson.phase} / 6</span><button type="button" className={styles.close} aria-label="Закрыть обучение" onClick={() => guide.dismiss()}>×</button></div>
    <h2 aria-live="polite">{lesson.title}</h2>
    <p id="mayor-tour-description">{lesson.text}</p>
    <div className={styles.clickHint}><span aria-hidden="true">↗</span>{lesson.hint}</div>
    <div className={styles.tourFooter}><button type="button" className={styles.skip} onClick={() => guide.dismiss()}>Пропустить обучение</button>{lesson.next && <button type="button" className={styles.primary} onClick={lesson.advance}>{lesson.next}</button>}</div>
  </Spotlight>;
}
