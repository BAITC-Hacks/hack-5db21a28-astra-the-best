// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { scenario } from '@/data';
import { simulate } from '@/domain/simulation';
import { ComparisonPanel } from '@/features/comparison/ComparisonPanel';
import { COMPARISON_STORAGE_KEY } from '@/features/comparison/storage';
import type { Decision } from '@/contracts';

const decisions: readonly Decision[] = [{ measureId: 'M7', districtId: 'nura' }, { measureId: 'M8', districtId: 'nura' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }, { measureId: 'M5', districtId: 'saryarka' }];
const simulation = simulate({ datasetVersion: scenario.datasetVersion, decisions });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('comparison panel user path', () => {
  it('saves, restores and loads a plan, then applies a verified suggestion without API calls', async () => {
    const user = userEvent.setup();
    const onLoadDecisions = vi.fn();
    const fetch = vi.spyOn(globalThis, 'fetch');
    const first = render(<ComparisonPanel scenario={scenario} simulation={simulation} onLoadDecisions={onLoadDecisions} />);
    await user.type(screen.getByLabelText('Название сценария'), 'Зелёный город');
    await user.click(screen.getByRole('button', { name: 'Сохранить текущий сценарий' }));
    expect(screen.getByRole('button', { name: 'Открыть Зелёный город' })).toBeTruthy();
    first.unmount();
    render(<ComparisonPanel scenario={scenario} simulation={simulation} onLoadDecisions={onLoadDecisions} />);
    await user.click(await screen.findByRole('button', { name: 'Открыть Зелёный город' }));
    expect(onLoadDecisions).toHaveBeenLastCalledWith(simulation.decisions);
    await user.click(screen.getByRole('button', { name: 'Найти проверяемое улучшение' }));
    await user.click(screen.getByRole('button', { name: 'Перенести улучшение в план' }));
    const loaded = onLoadDecisions.mock.lastCall![0] as readonly Decision[];
    expect(simulate({ datasetVersion: scenario.datasetVersion, decisions: loaded }).result.score).toBeGreaterThan(simulation.result.score);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not offer stale improvement after current scenario changes', async () => {
    const user = userEvent.setup();
    const view = render(<ComparisonPanel scenario={scenario} simulation={simulation} onLoadDecisions={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Найти проверяемое улучшение' }));
    expect(screen.getByRole('button', { name: 'Перенести улучшение в план' })).toBeTruthy();
    view.rerender(<ComparisonPanel scenario={scenario} simulation={null} onLoadDecisions={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Перенести улучшение в план' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сохранить текущий сценарий' })).toBeNull();
  });
  it('shows storage failure and never claims save succeeded', async () => {
    const user = userEvent.setup();
    render(<ComparisonPanel scenario={scenario} simulation={simulation} onLoadDecisions={vi.fn()} />);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await user.click(screen.getByRole('button', { name: 'Сохранить текущий сценарий' }));
    await waitFor(() => expect(screen.getByText(/Браузер не разрешил сохранение/)).toBeTruthy());
    expect(localStorage.getItem(COMPARISON_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText(/Сценарий сохранён/)).toBeNull();
    setItem.mockRestore();
  });
});
