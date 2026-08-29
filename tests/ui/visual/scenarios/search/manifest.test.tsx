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
    expect(view.getByText('更多筛选 · 已设置')).toBeTruthy();
    expect(view.getByText('确认筛选')).toBeTruthy();
  });
});
