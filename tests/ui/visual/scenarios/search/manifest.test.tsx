jest.mock('@shopify/flash-list', () => {
  const React = require('react') as typeof import('react');
  return {
    FlashList: () => null,
    useMappingHelper: () => ({ getMappingKey: (value: string) => value }),
    useRecyclingState: (initialValue: unknown) => React.useState(initialValue)
  };
});

import { QueryTestWrapper } from '../../../QueryTestWrapper';
import { fireEvent, render } from '../../../render';
import { searchVisualScenarios } from './manifest';

describe('search visual scenarios', () => {
  it('opens linux.do advanced filters through the production sheet', async () => {
    const scenario = searchVisualScenarios.find(({ id }) => id === 'search.filters.linuxdo.advanced');
    if (scenario?.kind !== 'rendered') throw new Error('Missing rendered advanced-filter scenario');

    const view = await render(<QueryTestWrapper>{scenario.render()}</QueryTestWrapper>);

    await fireEvent.press(view.getByLabelText(/打开搜索筛选/));
    expect(view.getByTestId('search-filter-close')).toBeTruthy();
    const expanded = view.getByLabelText('收起更多筛选，已设置');
    expect(expanded.props.accessibilityState.expanded).toBe(true);
    const range = view.getByLabelText('设置帖子数范围');
    expect(range.props.accessibilityValue.text).toBe('2–50');
    await fireEvent.press(range);
    expect(view.getByTestId('search-filter-input-minPosts').props.value).toBe('2');
    await fireEvent.press(view.getByRole('button', { name: '确认范围' }));
    await fireEvent.press(view.getByLabelText('收起更多筛选，已设置'));
    expect(view.getByText('更多筛选 · 已设置')).toBeTruthy();
  });
});
