import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  useWindowDimensions: () => ({ height: 800, width: 400 })
}));

import { viewportBoundedScrollHeight } from './ViewportBoundedScrollView';

describe('viewport-bounded modal scrolling', () => {
  it('keeps the existing 58 percent modal body limit local to the scroll view', () => {
    expect(viewportBoundedScrollHeight(800)).toBe(464);
    expect(viewportBoundedScrollHeight(400)).toBe(320);
  });
});
