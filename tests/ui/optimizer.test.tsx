// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnalyzeResponse, Decision, ScenarioResponse } from '@/contracts';
import { scenario } from '@/data';
import { simulate } from '@/domain/simulation';
import { OptimizerPanel } from '@/features/optimizer/OptimizerPanel';
import { formatBudget } from '@/lib/budget';
import { controlRequest } from '../data/source-fixture';

const simulation = simulate(controlRequest);
const candidate = { datasetVersion: scenario.datasetVersion, datasetHash: scenario.datasetHash, method: 'exhaustive', checkedCandidates: 123456, simulation };
const analysis: AnalyzeResponse = {
  datasetVersion: scenario.datasetVersion,
  scenarioId: simulation.scenarioId,
  provider: 'test', model: 'test',
  facts: [{ id: 'score', label: 'Итоговый Score', value: simulation.result.score, unit: 'балла' }],
  analysis: {
    summary: { text: 'План поддерживает качество жизни.', factIds: ['score'] },
    strengths: [{ text: 'Районы получают поддержку.', factIds: ['score'] }],
    risks: [{ text: 'Отдельные потребности остаются.', factIds: ['score'] }],
    consequences: [{ text: 'Эффект появляется постепенно.', factIds: ['score'] }],
    recommendation: { text: 'Сравните приоритеты районов.', factIds: ['score'] },
  },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
function setupFetch() { const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher); return fetcher; }
function Harness({ onApply, disabled = false }: { onApply: (decisions: readonly Decision[]) => void; disabled?: boolean }) {
  const [decisions, setDecisions] = useState<readonly Decision[]>([]);
  return <OptimizerPanel scenario={scenario} decisions={decisions} disabled={disabled} onApply={(next) => { setDecisions(next); onApply(next); }} />;
}
const find = () => screen.getByRole('button', { name: 'Найти лучший план с ИИ' });
const apply = () => screen.getByRole('button', { name: 'Применить лучший план' });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('OptimizerPanel', () => {
  it('waits for a click, previews before AI completes, and applies only after explicit confirmation', async () => {
    const fetcher = setupFetch();
    const pending = deferred();
    fetcher.mockResolvedValueOnce(json(candidate)).mockReturnValueOnce(pending.promise);
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<Harness onApply={onApply} />);
    expect(fetcher).not.toHaveBeenCalled();
    await user.click(find());
    await screen.findByText('ИИ разбирает найденный план. Его уже можно применить.');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe('/api/optimize');
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ datasetVersion: scenario.datasetVersion, datasetHash: scenario.datasetHash });
    expect(fetcher.mock.calls[1][0]).toBe('/api/analyze');
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ datasetVersion: scenario.datasetVersion, decisions: simulation.decisions });
    expect(screen.getByText(formatBudget(simulation.remainingBudget))).toBeTruthy();
    for (const decision of simulation.decisions) expect(screen.getByText(scenario.measures.find((item) => item.id === decision.measureId)!.name)).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(onApply).not.toHaveBeenCalled();
    await user.click(apply());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(simulation.decisions);
    expect(apply().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Пять решений перенесены в план/)).toBeTruthy();
    await act(async () => { pending.resolve(json(analysis)); });
    expect(await screen.findByText(analysis.analysis.summary.text)).toBeTruthy();
    expect(screen.getByText('Сильные стороны')).toBeTruthy();
    expect(screen.getByText('Риски')).toBeTruthy();
    expect(screen.getByText('Последствия')).toBeTruthy();
    expect(screen.getByText('Совет ИИ')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retains the candidate after AI fails and retries only its explanation', async () => {
    const fetcher = setupFetch();
    fetcher.mockResolvedValueOnce(json(candidate)).mockResolvedValueOnce(json({ error: { message: 'ИИ временно недоступен' } }, 503)).mockResolvedValueOnce(json(analysis));
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<OptimizerPanel scenario={scenario} decisions={[]} onApply={onApply} />);
    await user.click(find());
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'ИИ временно недоступен');
    expect(apply().hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Найденный план и его Score сохранены.')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Повторить объяснение ИИ' }));
    expect(await screen.findByText(analysis.analysis.summary.text)).toBeTruthy();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/optimize', '/api/analyze', '/api/analyze']);
    await user.click(apply());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(simulation.decisions);
  });

  it('deduplicates rapid clicks during search and AI loading', async () => {
    const fetcher = setupFetch();
    const pendingSearch = deferred();
    const pendingAnalysis = deferred();
    fetcher.mockReturnValueOnce(pendingSearch.promise).mockReturnValueOnce(pendingAnalysis.promise);
    render(<OptimizerPanel scenario={scenario} decisions={[]} onApply={vi.fn()} />);
    act(() => { fireEvent.click(find()); fireEvent.click(find()); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { pendingSearch.resolve(json(candidate)); });
    fireEvent.click(find());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(find().hasAttribute('disabled')).toBe(true);
    await act(async () => { pendingAnalysis.resolve(json(analysis)); });
    expect(find().hasAttribute('disabled')).toBe(false);
  });

  it('shows search failure without launching AI and permits a fresh search', async () => {
    const fetcher = setupFetch();
    fetcher.mockRejectedValueOnce(new Error('Сеть недоступна')).mockResolvedValueOnce(json(candidate)).mockResolvedValueOnce(json(analysis));
    const user = userEvent.setup();
    render(<OptimizerPanel scenario={scenario} decisions={[]} onApply={vi.fn()} />);
    await user.click(find());
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Сеть недоступна');
    expect(screen.queryByRole('button', { name: 'Применить лучший план' })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await user.click(find());
    await screen.findByText(analysis.analysis.summary.text);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/optimize', '/api/optimize', '/api/analyze']);
  });

  it.each(['version', 'hash', 'score'] as const)('rejects a candidate with a mismatching %s', async (mismatch) => {
    const fetcher = setupFetch();
    const invalid = mismatch === 'version' ? { ...candidate, datasetVersion: 'old' } : mismatch === 'hash' ? { ...candidate, datasetHash: 'old' } : { ...candidate, simulation: { ...simulation, result: { ...simulation.result, score: simulation.result.score + 1 } } };
    fetcher.mockResolvedValueOnce(json(invalid));
    render(<OptimizerPanel scenario={scenario} decisions={[]} onApply={vi.fn()} />);
    await userEvent.setup().click(find());
    await screen.findByRole('alert');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Применить лучший план' })).toBeNull();
  });

  it.each(['version', 'scenario', 'facts'] as const)('rejects AI with a mismatching %s while retaining the plan', async (mismatch) => {
    const fetcher = setupFetch();
    const invalid = mismatch === 'version' ? { ...analysis, datasetVersion: 'old' } : mismatch === 'scenario' ? { ...analysis, scenarioId: 'other-plan' } : { ...analysis, facts: [] };
    fetcher.mockResolvedValueOnce(json(candidate)).mockResolvedValueOnce(json(invalid));
    render(<OptimizerPanel scenario={scenario} decisions={[]} onApply={vi.fn()} />);
    await userEvent.setup().click(find());
    await screen.findByRole('alert');
    expect(screen.queryByText(analysis.analysis.summary.text)).toBeNull();
    expect(apply().hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Повторить объяснение ИИ' })).toBeTruthy();
  });

  it('aborts an unmounted search and ignores its late response before starting AI', async () => {
    const fetcher = setupFetch();
    const pending = deferred();
    fetcher.mockReturnValueOnce(pending.promise);
    const { unmount } = render(<OptimizerPanel scenario={scenario} decisions={[]} onApply={vi.fn()} />);
    await userEvent.setup().click(find());
    const signal = fetcher.mock.calls[0][1]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(json(candidate)); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('clears the result on dataset changes and ignores a late AI answer', async () => {
    const fetcher = setupFetch();
    const pending = deferred();
    fetcher.mockResolvedValueOnce(json(candidate)).mockReturnValueOnce(pending.promise);
    const onApply = vi.fn();
    const { rerender } = render(<OptimizerPanel scenario={scenario} decisions={[]} onApply={onApply} />);
    await userEvent.setup().click(find());
    await screen.findByText('ИИ разбирает найденный план. Его уже можно применить.');
    const nextScenario: ScenarioResponse = { ...scenario, datasetHash: 'updated-hash' };
    rerender(<OptimizerPanel scenario={nextScenario} decisions={[]} onApply={onApply} />);
    expect(fetcher.mock.calls[1][1]!.signal!.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Применить лучший план' })).toBeNull();
    await act(async () => { pending.resolve(json(analysis)); });
    expect(screen.queryByText(analysis.analysis.summary.text)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('aborts pending search on a dataset version change without any automatic request', async () => {
    const fetcher = setupFetch();
    const pending = deferred();
    fetcher.mockReturnValueOnce(pending.promise);
    const onApply = vi.fn();
    const { rerender } = render(<OptimizerPanel scenario={scenario} decisions={[]} onApply={onApply} />);
    await userEvent.setup().click(find());
    rerender(<OptimizerPanel scenario={{ ...scenario, datasetVersion: 'next' }} decisions={[]} onApply={onApply} />);
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
    await act(async () => { pending.resolve(json(candidate)); });
    expect(screen.queryByRole('button', { name: 'Применить лучший план' })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honors the parent calculation lock for search and applying a candidate', async () => {
    const fetcher = setupFetch();
    fetcher.mockResolvedValueOnce(json(candidate)).mockResolvedValueOnce(json(analysis));
    const onApply = vi.fn();
    const { rerender } = render(<OptimizerPanel scenario={scenario} decisions={[]} onApply={onApply} disabled />);
    fireEvent.click(find());
    expect(fetcher).not.toHaveBeenCalled();
    rerender(<OptimizerPanel scenario={scenario} decisions={[]} onApply={onApply} />);
    await userEvent.setup().click(find());
    await screen.findByText(analysis.analysis.summary.text);
    rerender(<OptimizerPanel scenario={scenario} decisions={[]} onApply={onApply} disabled />);
    expect(apply().hasAttribute('disabled')).toBe(true);
    fireEvent.click(apply());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('recalculates the comparison when the current draft changes without repeating requests', async () => {
    const fetcher = setupFetch();
    fetcher.mockResolvedValueOnce(json(candidate)).mockResolvedValueOnce(json(analysis));
    const onApply = vi.fn();
    const { rerender } = render(<OptimizerPanel scenario={scenario} decisions={[]} onApply={onApply} />);
    await userEvent.setup().click(find());
    await screen.findByText(analysis.analysis.summary.text);
    expect(screen.queryByText(/К вашему текущему плану/)).toBeNull();
    rerender(<OptimizerPanel scenario={scenario} decisions={simulation.decisions} onApply={onApply} />);
    expect(screen.getByText('Ваш текущий план уже набирает этот максимум.')).toBeTruthy();
    expect(apply().hasAttribute('disabled')).toBe(true);
    await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
  });
});
