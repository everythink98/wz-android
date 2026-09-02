import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, render, waitFor } from '../render';
import { StyleSheet } from 'react-native';
import { ForumMath } from '@/features/topic/rendering/ForumMath';
import type { MathJaxSvgResult } from '@/features/topic/rendering/mathJaxSvg';

const mockRenderMathJaxSvg = jest.fn<(source: string, display: boolean) => Promise<MathJaxSvgResult>>();

jest.mock('@/features/topic/rendering/mathJaxSvg', () => ({
  renderMathJaxSvg: (...args: [string, boolean]) => mockRenderMathJaxSvg(...args)
}));

jest.mock('react-native-svg', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    SvgXml: (props: Record<string, unknown>) =>
      ReactModule.createElement(NativeView, { ...props, testID: 'forum-math-svg' })
  };
});

const svgResult: MathJaxSvgResult = {
  heightEx: 10,
  verticalAlignEx: -0.2,
  viewBox: '0 -750 4000 1000',
  widthEx: 100,
  xml: '<svg viewBox="0 -750 4000 1000"><path /></svg>'
};

describe('Topic formula rendering', () => {
  it('shows readable TeX while loading and scales a block SVG to content width', async () => {
    let resolve!: (result: MathJaxSvgResult) => void;
    mockRenderMathJaxSvg.mockReturnValueOnce(new Promise((next) => (resolve = next)));
    const view = await render(
      <ForumMath
        boundarySpacing={{ marginTop: 0 }}
        color="#102030"
        contentWidth={300}
        display="block"
        fontScale={1}
        source="x^2"
      />
    );

    expect(StyleSheet.flatten(view.getByText('x^2').props.style)).toMatchObject({ marginTop: 0, marginVertical: 8 });
    expect(view.getByLabelText('公式：x^2')).toBeTruthy();
    await act(async () => resolve(svgResult));

    const svg = await waitFor(() => view.getByTestId('forum-math-svg'));
    expect(svg.props).toMatchObject({
      accessibilityLabel: '公式：x^2',
      color: '#102030',
      height: 30,
      width: 300,
      xml: svgResult.xml
    });
    expect(StyleSheet.flatten(svg.parent?.props.style)).toMatchObject({ marginTop: 0, marginVertical: 8 });
  });

  it('keeps raw TeX when conversion fails', async () => {
    mockRenderMathJaxSvg.mockRejectedValueOnce(new Error('bad TeX'));
    const view = await render(
      <ForumMath color="#102030" contentWidth={300} display="inline" fontScale={1} source={'\\bad'} />
    );

    await waitFor(() => expect(mockRenderMathJaxSvg).toHaveBeenCalledWith('\\bad', false));
    expect(view.getByText('\\bad').props.selectable).toBe(false);
    expect(view.queryByTestId('forum-math-svg')).toBeNull();
  });
});
