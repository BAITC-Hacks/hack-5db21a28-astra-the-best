// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { Map } from 'maplibre-gl';
import { scenario } from '@/data';
import { CityEffects } from '@/features/city-effects/CityEffects';

const tracker = vi.hoisted(() => ({ created: 0, removed: 0 }));
vi.mock('maplibre-gl', () => ({
  Marker: class {
    constructor() { tracker.created++; }
    setLngLat() { return this; }
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

afterEach(() => { cleanup(); tracker.created = 0; tracker.removed = 0; });

describe('CityEffects lifecycle', () => {
  it('replaces scene markers and cleans them up on unmount', async () => {
    const map = {} as Map;
    const { rerender, unmount } = render(<CityEffects map={map} scenario={scenario} decisions={[{ measureId: 'M7', districtId: 'nura' }]} comparison="before" />);
    await waitFor(() => expect(tracker.created).toBe(1));
    rerender(<CityEffects map={map} scenario={scenario} decisions={[{ measureId: 'M12' }]} comparison="before" />);
    await waitFor(() => expect(tracker.created).toBe(6));
    expect(tracker.removed).toBe(1);
    unmount();
    expect(tracker.removed).toBe(6);
  });
});
