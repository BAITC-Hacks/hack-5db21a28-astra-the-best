// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { CityDecoration, positionAlongRoad } from './CityDecoration';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('interpolates along road vertices and reverses at the endpoint', () => {
  const route = [[71, 51], [71.01, 51], [71.01, 51.01]];
  expect(positionAlongRoad(route, 0)).toEqual(route[0]);
  expect(positionAlongRoad(route, 1)).toEqual(route[2]);
  expect(positionAlongRoad(route, 0.4)).toEqual(positionAlongRoad(route, 1.6));
});

it('bounds source updates, pauses hidden/reduced motion, and cleans up', () => {
  vi.useFakeTimers();
  const motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => motion);
  const setData = vi.fn();
  let added = false;
  const map = {
    isStyleLoaded: () => true, isMoving: () => false, getZoom: () => 13,
    getSource: () => added ? { setData } : undefined,
    addSource: () => { added = true; }, addLayer: vi.fn(), getLayer: () => true,
    removeLayer: vi.fn(), removeSource: vi.fn(), on: vi.fn(), once: vi.fn(), off: vi.fn(),
    getStyle: () => ({ layers: [{ id: 'road', type: 'line', 'source-layer': 'transportation' }] }),
    queryRenderedFeatures: () => Array.from({ length: 30 }, (_, i) => ({ properties: { class: 'primary' },
      geometry: { type: 'LineString', coordinates: [[71 + i / 1000, 51], [71.01 + i / 1000, 51]] } })),
  };
  const { rerender } = render(<CityDecoration map={map as unknown as MapLibreMap} active />);
  expect(setData.mock.calls[0][0].features).toHaveLength(16);
  vi.advanceTimersByTime(1000);
  expect(setData).toHaveBeenCalledTimes(9);
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  document.dispatchEvent(new Event('visibilitychange'));
  const hiddenCount = setData.mock.calls.length;
  vi.advanceTimersByTime(1000);
  expect(setData).toHaveBeenCalledTimes(hiddenCount);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  document.dispatchEvent(new Event('visibilitychange'));
  motion.matches = true;
  motion.addEventListener.mock.calls[0][1]();
  const count = setData.mock.calls.length;
  vi.advanceTimersByTime(1000);
  expect(setData).toHaveBeenCalledTimes(count);
  expect(setData.mock.lastCall?.[0].features).toHaveLength(0);
  rerender(<CityDecoration map={map as unknown as MapLibreMap} active={false} />);
  expect(map.removeSource).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
