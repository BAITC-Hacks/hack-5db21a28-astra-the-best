// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { Map } from 'maplibre-gl';
import { scenario } from '@/data';
import { CityEffects } from '@/features/city-effects/CityEffects';

const tracker = vi.hoisted(() => ({ created: 0, removed: 0, offsets: 0, anchors: [] as string[] }));
vi.mock('maplibre-gl', () => ({
  Marker: class {
    constructor(options: { anchor: string }) { tracker.created++; tracker.anchors.push(options.anchor); }
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

afterEach(() => { cleanup(); tracker.created = 0; tracker.removed = 0; tracker.offsets = 0; tracker.anchors = []; });

describe('CityEffects lifecycle', () => {
  it('replaces scene markers and cleans them up on unmount', async () => {
    const container = document.createElement('div');
    const on = vi.fn();
    const off = vi.fn();
    const map = { getContainer: () => container, getSource: () => undefined, getLayer: () => undefined, on, off } as unknown as Map;
    const { rerender, unmount } = render(<CityEffects map={map} scenario={scenario} decisions={[{ measureId: 'M7', districtId: 'nura' }]} comparison="before" />);
    await waitFor(() => expect(tracker.created).toBe(1));
    expect(tracker.offsets).toBe(0);
    expect(tracker.anchors).toEqual(['bottom']);
    rerender(<CityEffects map={map} scenario={scenario} decisions={[{ measureId: 'M12' }]} comparison="before" />);
    await waitFor(() => expect(tracker.created).toBe(6));
    expect(tracker.removed).toBe(1);
    expect(tracker.offsets).toBe(0);
    unmount();
    expect(tracker.removed).toBe(6);
    expect(container.querySelectorAll('svg')).toHaveLength(0);
    expect(on).not.toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled();
  });
});
