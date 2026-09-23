// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnalysisState, Decision, DistrictId, IndicatorId } from '@/contracts';
import { scenario } from '@/data';
import { MayorGuide } from '@/features/onboarding/MayorGuide';

vi.mock('@/features/onboarding/Spotlight', () => ({
  Spotlight: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
}));

const decisions: Decision[] = [
  { measureId: 'M7', districtId: 'nura' }, { measureId: 'M8', districtId: 'nura' },
  { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }, { measureId: 'M5', districtId: 'nura' },
];
const success: AnalysisState = { status: 'success', response: {
  datasetVersion: scenario.datasetVersion, scenarioId: 'test', provider: 'test', model: 'test', facts: [],
  analysis: { summary: { text: 'Test', factIds: [] }, recommendation: { text: 'Test', factIds: [] }, strengths: [], risks: [], consequences: [] },
} };
interface State {
  selectedDistrictId: DistrictId | null;
  indicatorId: IndicatorId | null;
  decisions: Decision[];
  hasResult: boolean;
  plannerOpen: boolean;
  mode: 'city' | 'report';
  analysis: AnalysisState;
}
function Harness(props: State) {
  const [reportRead, setReportRead] = useState(false);
  return <MayorGuide {...props} scenario={scenario} guide={{ state: 'active', reportRead, readReport: () => setReportRead(true), restart: vi.fn(), start: vi.fn(), dismiss: vi.fn() }} />;
}
function openTour(initial: Partial<State> = {}) {
  let props: State = { selectedDistrictId: null, indicatorId: null, decisions: [], hasResult: false, plannerOpen: false, mode: 'city', analysis: { status: 'idle' }, ...initial };
  const view = render(<Harness {...props} />);
  return { ...view, update: (changes: Partial<State>) => { props = { ...props, ...changes }; view.rerender(<Harness {...props} />); } };
}
function progress(current: number, total: number) {
  expect(screen.getByLabelText(`Шаг ${current} из ${total}`).textContent).toBe(`Ваш первый день · ${current} / ${total}`);
}
const click = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole('button', { name }));

afterEach(cleanup);

describe('Actual tutorial progress', () => {
  it('counts each short-tour action, moves back, and keeps AI retries on the same step', async () => {
    const user = userEvent.setup();
    const tour = openTour();
    progress(1, 18);
    tour.update({ selectedDistrictId: 'nura' });
    progress(2, 18);
    await click(user, 'Сравнить районы');
    progress(3, 18);
    await click(user, 'Назад');
    progress(2, 18);
    await click(user, 'Сравнить районы');
    tour.update({ selectedDistrictId: null });
    progress(4, 18);
    tour.update({ indicatorId: 'S1' });
    progress(5, 18);
    await click(user, 'Понятно, составим план');
    progress(6, 18);
    tour.update({ selectedDistrictId: 'nura' });
    progress(7, 18);
    tour.update({ plannerOpen: true });
    progress(8, 18);
    tour.update({ decisions: decisions.slice(0, 1) });
    progress(9, 18);
    await click(user, 'Добавить следующее решение');
    progress(10, 18);
    for (let count = 2; count <= 5; count++) {
      tour.update({ decisions: decisions.slice(0, count) });
      progress(count + 9, 18);
    }
    tour.update({ hasResult: true, mode: 'report', plannerOpen: false });
    progress(15, 18);
    await click(user, 'А кому стало лучше?');
    progress(16, 18);
    tour.update({ mode: 'city' });
    progress(16, 18);
    tour.update({ mode: 'report' });
    await click(user, 'Перейти к ИИ-разбору');
    progress(17, 18);
    for (const analysis of [
      { status: 'loading', scenarioId: 'test' },
      { status: 'error', scenarioId: 'test', error: { error: { code: 'AI_UNAVAILABLE', message: 'test', issues: [] } } },
      { status: 'loading', scenarioId: 'test' },
    ] satisfies AnalysisState[]) {
      tour.update({ analysis });
      progress(17, 18);
    }
    tour.update({ analysis: success });
    progress(18, 18);
    tour.unmount();
    openTour();
    progress(1, 18);
  });

  it('starts a replay with the existing result and analysis on its shorter real route', async () => {
    const user = userEvent.setup();
    const tour = openTour({ hasResult: true, analysis: success, decisions, selectedDistrictId: 'nura', indicatorId: 'S1' });
    progress(1, 7);
    await click(user, 'Сравнить районы');
    progress(2, 7);
    tour.update({ selectedDistrictId: null });
    progress(3, 7);
    await click(user, 'Понятно, составим план');
    progress(4, 7);
    tour.update({ mode: 'report' });
    progress(5, 7);
    tour.update({ mode: 'city' });
    progress(5, 7);
    tour.update({ mode: 'report' });
    progress(5, 7);
    await click(user, 'А кому стало лучше?');
    progress(6, 7);
    await click(user, 'Перейти к ИИ-разбору');
    progress(7, 7);
  });

  it('accounts for an existing draft without shrinking the total as more decisions are added', async () => {
    const user = userEvent.setup();
    const tour = openTour({ decisions: decisions.slice(0, 2), selectedDistrictId: 'nura' });
    progress(1, 15);
    await click(user, 'Сравнить районы');
    tour.update({ selectedDistrictId: null });
    tour.update({ indicatorId: 'S1' });
    await click(user, 'Понятно, составим план');
    tour.update({ selectedDistrictId: 'nura', plannerOpen: true });
    progress(7, 15);
    await click(user, 'Добавить следующее решение');
    progress(8, 15);
    tour.update({ decisions: decisions.slice(0, 3) });
    progress(9, 15);
    tour.update({ decisions: decisions.slice(0, 2) });
    progress(8, 15);
  });

  it('restores an initially completed step if the user needs it again', async () => {
    const user = userEvent.setup();
    const tour = openTour({ selectedDistrictId: 'nura', indicatorId: 'S1' });
    progress(1, 16);
    await click(user, 'Сравнить районы');
    tour.update({ selectedDistrictId: null });
    progress(3, 16);
    await click(user, 'Назад');
    progress(1, 17);
    tour.update({ selectedDistrictId: 'nura' });
    progress(2, 17);
  });
});
