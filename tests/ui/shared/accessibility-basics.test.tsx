import { describe, expect, it } from '@jest/globals';
import { render } from '../render';
import React from 'react';
import { LoadingState } from '@/ui/controls/FeedbackStates';

describe('REG-A11Y-001 shared accessibility basics', () => {
  it('announces loading once as a polite busy status', async () => {
    const view = await render(<LoadingState text="正在读取主题" />);
    const status = view.getByRole('status');

    expect(status.props).toMatchObject({
      accessible: true,
      accessibilityLabel: '正在读取主题',
      accessibilityLiveRegion: 'polite',
      accessibilityState: { busy: true }
    });
    const [indicator] = view.root?.queryAll((instance) => instance.type === 'ActivityIndicator') || [];
    expect(indicator.props.accessible).toBe(false);
    expect(view.getByText('正在读取主题').props.accessible).toBe(false);
  });
});
