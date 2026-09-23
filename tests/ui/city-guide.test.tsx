// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { scenario } from '@/data';
import type { DistrictId, IndicatorId, SimulationResponse } from '@/contracts';
import { simulate } from '@/domain/simulation';
import { MayorGuide, useMayorGuide } from '@/features/onboarding/MayorGuide';
import type { TourTarget } from '@/features/onboarding/Spotlight';

vi.mock('@/features/onboarding/Spotlight', () => ({
  Spotlight: ({ children, target }: { children: ReactNode; target: TourTarget }) => <aside aria-label="Помощник градоначальника" data-target={target.selector}>{children}</aside>,
}));

function Harness({ hasResult = false, simulation, comparison = 'before' }: { hasResult?: boolean; simulation?: SimulationResponse; comparison?: 'before' | 'after' }) {
  const guide = useMayorGuide(false);
  const [indicatorId, setIndicatorId] = useState<IndicatorId | null>(null);
  const [districtId, setDistrictId] = useState<DistrictId | null>('nura');
  return <>
    <button onClick={guide.start}>Начать проверку</button>
    <button onClick={() => setIndicatorId('S1')}>Выбрать слой S1</button>
    <button onClick={() => setDistrictId(null)}>Закрыть район</button>
    <button onClick={() => setDistrictId('nura')}>Выбрать Нуру</button>
    <MayorGuide guide={guide} scenario={scenario} decisions={[]} selectedDistrictId={districtId} hasResult={hasResult} simulation={simulation} comparison={comparison} indicatorId={indicatorId} analysis={{ status: 'idle' }} plannerOpen={false} mode="city" />
  </>;
}

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('City overview tutorial', () => {
  it('gives one general overview then goes directly to district comparison', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Начать проверку' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/Нура: узнайте/);
    expect(screen.getByLabelText('Помощник градоначальника').textContent).toMatch(/0.{0,5}100/);
    expect(screen.getByLabelText('Помощник градоначальника').textContent).toContain('ниже 40');
    expect(screen.queryByRole('button', { name: 'Изучить показатели' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Следующий показатель' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Сравнить районы' }));
    expect(screen.queryByRole('button', { name: 'Понятно, составим план' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Теперь посмотрим на весь город');
    await user.click(screen.getByRole('button', { name: 'Закрыть район' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Включите слой школ и детсадов');
    await user.click(screen.getByRole('button', { name: 'Выбрать слой S1' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Сравните районы по одному показателю');
    await user.click(screen.getByRole('button', { name: 'Понятно, составим план' }));
    await user.click(screen.getByRole('button', { name: 'Выбрать Нуру' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Теперь откройте вашу панель решений');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('starts the city explanation again even when a calculated report exists', async () => {
    const user = userEvent.setup();
    render(<Harness hasResult />);
    await user.click(screen.getByRole('button', { name: 'Начать проверку' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/Нура: узнайте/);
    expect(screen.getByRole('button', { name: 'Сравнить районы' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Вот результат вашей работы' })).toBeNull();
  });

  it('describes the current critical state after calculation without individual metric steps', async () => {
    const user = userEvent.setup();
    const simulation = simulate({ datasetVersion: scenario.datasetVersion, decisions: [
      { measureId: 'M7', districtId: 'nura' }, { measureId: 'M8', districtId: 'nura' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }, { measureId: 'M5', districtId: 'saryarka' },
    ] });
    render(<Harness hasResult simulation={simulation} comparison="after" />);
    await user.click(screen.getByRole('button', { name: 'Начать проверку' }));
    expect(screen.getByLabelText('Помощник градоначальника').textContent).toContain('Показаны значения после ваших решений');
    expect(screen.getByLabelText('Помощник градоначальника').textContent).toContain('Критических значений сейчас нет.');
    expect(screen.queryByRole('button', { name: 'Следующий показатель' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Сравнить районы' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Теперь посмотрим на весь город');
  });
});
