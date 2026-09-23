'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './SelectMenu.module.css';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectMenuProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function SelectMenu<T extends string>({ label, value, options, onChange }: SelectMenuProps<T>) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(Math.max(rect.width, 230), viewportWidth - 24);
      const left = Math.min(Math.max(12, rect.left), viewportWidth - width - 12);
      const estimatedHeight = Math.min(320, options.length * 44 + 12);
      const below = viewportHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const showAbove = below < Math.min(estimatedHeight, 220) && above > below;
      const maxHeight = Math.max(80, Math.min(estimatedHeight, showAbove ? above : below));
      setPosition({ top: showAbove ? rect.top - maxHeight - 8 : rect.bottom + 8, left, width, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, id, open]);

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        setOpen(true);
      } else {
        setActiveIndex((index) => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
      }
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return <div className={styles.field}>
    <span id={`${id}-label`} className={styles.label}>{label}</span>
    <button
      ref={triggerRef}
      type="button"
      role="combobox"
      aria-labelledby={`${id}-label`}
      aria-controls={open ? `${id}-listbox` : undefined}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
      className={`${styles.trigger} ${open ? styles.expanded : ''}`}
      onClick={() => { setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0); setOpen((wasOpen) => !wasOpen); }}
      onKeyDown={onKeyDown}
    >
      <span className={styles.value}>{selected?.label ?? 'Выберите значение'}</span>
      <svg className={styles.chevron} viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && position && createPortal(<div
      ref={menuRef}
      id={`${id}-listbox`}
      role="listbox"
      aria-labelledby={`${id}-label`}
      className={styles.menu}
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
    >{options.map((option, index) => <div
      key={option.value}
      id={`${id}-option-${index}`}
      role="option"
      aria-selected={option.value === value}
      className={`${styles.option} ${index === activeIndex ? styles.active : ''}`}
      onMouseEnter={() => setActiveIndex(index)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => choose(index)}
    ><span>{option.label}</span>{option.value === value && <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}</div>)}</div>, document.body)}
  </div>;
}
