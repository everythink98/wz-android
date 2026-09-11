import { describe, expect, it, vi } from 'vitest';
import * as htmlRenderingStyles from './htmlStyles';

vi.mock('react-native', () => ({ StyleSheet: { hairlineWidth: 1 } }));

describe('Topic content boundaries', () => {
  it('exposes exact leading and trailing spacing for a continuation fragment', () => {
    expect(htmlRenderingStyles.contentBoundaryForContinuation('first')).toEqual({
      trimLeading: false,
      trimTrailing: true
    });
    expect(htmlRenderingStyles.contentBoundaryForContinuation('middle')).toEqual({
      trimLeading: true,
      trimTrailing: true
    });
    expect(htmlRenderingStyles.contentBoundaryForContinuation('last')).toEqual({
      trimLeading: true,
      trimTrailing: false
    });
    expect(htmlRenderingStyles.contentBoundaryForContinuation('only')).toEqual({
      trimLeading: false,
      trimTrailing: false
    });
  });
});
