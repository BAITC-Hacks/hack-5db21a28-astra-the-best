// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { Map } from 'maplibre-gl';
import { scenario } from '@/data';
import { CityEffects } from '@/features/city-effects/CityEffects';

const tracker = vi.hoisted(() => ({ created: 0, removed: 0, offsets: 0 }));
vi.mock('maplibre-gl', () => ({
  Marker: class {
    constructor() { tracker.created++; }
    setLngLat() { return this; }
    setOffset() { tracker.offsets++; return this; }
    addTo() { return this; }
    remove() { tracker.removed++; }
  },
  Popup: class {
    setLngLat() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
    remove() { return this; }
  },
}));

afterEach(() => { cleanup(); tracker.created = 0; tracker.removed = 0; tracker.offsets = 0; vi.unstubAllGlobals(); });

describe('CityEffects lifecycle', () => {
  it('replaces scene markers and cleans them up on unmount', async () => {
    const container = document.createElement('div');
    const on = vi.fn();
    const off = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
    const map = { getContainer: () => container, getCanvasContainer: () => container, project: () => ({ x: 100, y: 100 }), on, off } as unknown as Map;
    const { rerender, unmount } = render(<CityEffects map={map} scenario={scenario} decisions={[{ measureId: 'M7', districtId: 'nura' }]} comparison="before" />);
    await waitFor(() => expect(tracker.created).toBe(1));
    expect(tracker.offsets).toBe(1);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    rerender(<CityEffects map={map} scenario={scenario} decisions={[{ measureId: 'M12' }]} comparison="before" />);
    await waitFor(() => expect(tracker.created).toBe(6));
    expect(tracker.removed).toBe(1);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    unmount();
    expect(tracker.removed).toBe(6);
    expect(container.querySelectorAll('svg')).toHaveLength(0);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(off.mock.calls).toEqual(on.mock.calls);
  });
});
