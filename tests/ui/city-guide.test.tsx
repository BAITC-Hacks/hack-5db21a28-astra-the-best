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

describe('City metric tutorial', () => {
  it('explains all ten real district metrics before asking to compare districts', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Начать проверку' }));
    await user.click(screen.getByRole('button', { name: 'Изучить показатели' }));
    for (let index = 0; index < scenario.indicators.length; index++) {
      const indicator = scenario.indicators[index];
      const value = scenario.districts.find((district) => district.id === 'nura')!.indicators[indicator.id];
      expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(indicator.name);
      expect(screen.getByLabelText('Помощник градоначальника').getAttribute('data-target')).toContain(indicator.id);
      expect(screen.getByLabelText('Помощник градоначальника').textContent).toContain(`Нура: ${value} из 100.`);
      if (indicator.id === 'T2') expect(screen.getByLabelText('Помощник градоначальника').textContent).toContain('Ровно 40 — граница, штрафа за этот показатель нет.');
      if (indicator.id === 'S1') {
        expect(screen.getByLabelText('Помощник градоначальника').textContent).toContain('Это критическое значение: ниже 40.');
        expect(screen.getByLabelText('Помощник градоначальника').textContent).toContain('полный эффект +16, с задержкой 3 кв. учитывается +10');
      }
      await user.click(screen.getByRole('button', { name: index === 9 ? 'Сравнить районы' : 'Следующий показатель' }));
    }
    expect(screen.queryByRole('button', { name: 'Следующий показатель' })).toBeNull();
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
    expect(screen.getByRole('button', { name: 'Изучить показатели' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Вот результат вашей работы' })).toBeNull();
  });

  it('explains the currently displayed post-calculation numbers and supports the previous metric', async () => {
    const user = userEvent.setup();
    const simulation = simulate({ datasetVersion: scenario.datasetVersion, decisions: [
      { measureId: 'M7', districtId: 'nura' }, { measureId: 'M8', districtId: 'nura' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }, { measureId: 'M5', districtId: 'saryarka' },
    ] });
    render(<Harness hasResult simulation={simulation} comparison="after" />);
    await user.click(screen.getByRole('button', { name: 'Начать проверку' }));
    expect(screen.getByLabelText('Помощник градоначальника').textContent).toContain('Показаны значения после ваших решений');
    await user.click(screen.getByRole('button', { name: 'Изучить показатели' }));
    for (let index = 0; index < 4; index++) await user.click(screen.getByRole('button', { name: 'Следующий показатель' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Школы и детсады');
    expect(screen.getByLabelText('Помощник градоначальника').textContent).toContain('Нура: 48 из 100.');
    expect(screen.getByLabelText('Помощник градоначальника').textContent).not.toContain('Это критическое значение');
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Качество воздуха');
  });
});
