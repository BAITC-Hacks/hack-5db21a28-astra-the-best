// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { scenario } from '@/data';
import { GuideHelp, MayorGuide, MayorWelcome, ONBOARDING_KEY, useMayorGuide } from '@/features/onboarding/MayorGuide';

function Harness() {
  const guide = useMayorGuide(true);
  return <><GuideHelp onClick={guide.restart} /><MayorWelcome guide={guide} scenario={scenario} /><MayorGuide guide={guide} scenario={scenario} decisions={[]} selectedDistrictId={null} hasResult={false} analysis={{ status: 'idle' }} plannerOpen={false} mode="city" /></>;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Обучение градоначальника', () => {
  it('remembers dismissal, suppresses the next welcome and allows replay', async () => {
    const user = userEvent.setup();
    const view = render(<Harness />);
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Освоюсь самостоятельно' }));
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('dismissed');
    view.unmount();
    render(<Harness />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Обучение/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Вступить в должность' }));
    expect(screen.getByRole('heading', { name: 'Начнём с жителей Нуры' })).toBeTruthy();
  });

  it('remains usable with blocked storage and restores body scrolling on Escape', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    render(<Harness />);
    const dialog = await screen.findByRole('dialog');
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.style.overflow).toBe('');
  });
});
