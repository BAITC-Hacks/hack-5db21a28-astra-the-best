// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { scenario } from '@/data';
import type { Decision, DistrictId } from '@/contracts';
import { Planner } from '@/features/planner/Planner';

function Harness({ initial = [], onCalculate = vi.fn() }: { initial?: readonly Decision[]; onCalculate?: () => void }) {
  const [decisions, setDecisions] = useState<readonly Decision[]>(initial);
  const [district, setDistrict] = useState<DistrictId | null>('nura');
  return <Planner scenario={scenario} decisions={decisions} selectedDistrictId={district} onDistrictSelect={setDistrict} onDecisionsChange={setDecisions} onCalculate={onCalculate} />;
}

function card(id: string) { return screen.getByText(new RegExp(`^${id} ·`)).closest('article')!; }
afterEach(cleanup);

describe('Planner', () => {
  it('builds the 95-unit example; four decisions remain a draft', async () => {
    const user = userEvent.setup();
    const calculate = vi.fn();
    render(<Harness onCalculate={calculate} />);
    for (const id of ['M7', 'M8', 'M10', 'M12']) await user.click(within(card(id)).getByRole('button', { name: 'Добавить в план' }));
    expect(screen.getByText('4 / 5 решений')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Рассчитать сценарий' }).hasAttribute('disabled')).toBe(true);
    await user.selectOptions(screen.getByLabelText('Район для районных мер'), 'saryarka');
    await user.click(within(card('M5')).getByRole('button', { name: 'Добавить в план' }));
    expect(screen.getByText('5 / 100')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Рассчитать сценарий' }));
    expect(calculate).toHaveBeenCalledOnce();
  });

  it('explains duplicates, direction limit, budget and conflicts', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ measureId: 'M1', districtId: 'nura' }, { measureId: 'M2' }]} />);
    expect(within(card('M1')).getByText('Мера уже выбрана.')).toBeTruthy();
    expect(within(card('M3')).getByText(/Не более 2 мер направления/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Удалить Выделенные полосы для автобусов' }));
    expect(within(card('M3')).getByRole('button', { name: 'Добавить в план' }).hasAttribute('disabled')).toBe(false);
    await user.click(within(card('M3')).getByRole('button', { name: 'Добавить в план' }));
    expect(within(card('M1')).getByText(/Выберите автобусные полосы или ЛРТ/)).toBeTruthy();
  });

  it('replaces a measure without changing the number of decisions', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ measureId: 'M9', districtId: 'nura' }]} />);
    await user.click(screen.getByRole('button', { name: 'Заменить Дворовые спорт-хабы' }));
    await user.click(within(card('M7')).getByRole('button', { name: 'Заменить мерой' }));
    expect(screen.getByText('1 / 5 решений')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить Школа + детсад (модульное строительство)' })).toBeTruthy();
  });

  it('shows loading and retry when data is unavailable', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Planner scenario={null} decisions={[]} selectedDistrictId={null} onDistrictSelect={vi.fn()} onDecisionsChange={vi.fn()} onCalculate={vi.fn()} loading onRetry={retry} />);
    expect(screen.getByRole('status').textContent).toMatch(/Загружаем/);
    rerender(<Planner scenario={null} decisions={[]} selectedDistrictId={null} onDistrictSelect={vi.fn()} onDecisionsChange={vi.fn()} onCalculate={vi.fn()} error="Сеть недоступна" onRetry={retry} />);
    expect(screen.getByRole('alert').textContent).toBe('Сеть недоступна');
    await user.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
