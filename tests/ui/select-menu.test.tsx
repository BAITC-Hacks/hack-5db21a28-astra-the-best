// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectMenu } from '@/components/SelectMenu';

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState('all');
  return <><SelectMenu label="Направление" value={value} onChange={setValue} options={[
    { value: 'all', label: 'Все направления' },
    { value: 'transport', label: 'Транспорт' },
    { value: 'green', label: 'Озеленение' },
  ]} /><button type="button">Следующий элемент</button></>;
}

describe('SelectMenu', () => {
  it('selects with keyboard and keeps the chosen value visible', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: 'Направление' });
    trigger.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(trigger.textContent).toContain('Транспорт');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{ArrowDown}{End}{Enter}');
    expect(trigger.textContent).toContain('Озеленение');
  });

  it('closes on Escape and outside pointer input without changing the value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: 'Направление' });
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Следующий элемент' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger.textContent).toContain('Все направления');
  });
});
