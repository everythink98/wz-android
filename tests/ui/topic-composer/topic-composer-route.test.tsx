import { useState } from 'react';
import { Button, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TopicComposerRoute } from '@/features/topic-composer/TopicComposerRoute';
import { appQueryClient } from '@/platform/query/serverState';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { act, fireEvent, render, waitFor } from '../render';

const mockRuntime = { sessionEpochs: { linuxdo: 0 }, getTopic: jest.fn(), notify: jest.fn() };
jest.mock('@/features/topic-composer/TopicComposerRouteRuntime', () => ({
  useTopicComposerRouteRuntime: () => mockRuntime
}));
jest.mock('@/features/topic-composer/useTopicComposerController', () => ({
  useTopicComposerController: ({ onEdited }: { onEdited: (source: string, id: string) => void }) => ({
    leave: async () => true,
    finish: () => onEdited('linuxdo', '123')
  })
}));
jest.mock('@/features/topic-composer/TopicComposerScreen', () => {
  const { Button } = require('react-native');
  return {
    TopicComposerScreen: ({ controller }: { controller: { finish: () => void } }) => (
      <Button title="完成模拟保存" onPress={controller.finish} />
    )
  };
});
const Stack = createNativeStackNavigator<RootStackParamList>();
const key = ['forum', 'linuxdo', 'topic', { topicId: '123', sessionEpoch: 0 }];
const previous = {
  source: 'linuxdo',
  id: '123',
  title: '旧标题',
  content: '旧正文',
  replies: [{ id: 'loaded-reply' }],
  replyHasMore: true,
  replyNextPage: 4,
  replyNextOffset: 60,
  replyCompleteness: { state: 'partial' }
};
function Topic({ open }: { open: () => void }) {
  const [position, setPosition] = useState('第一页');
  return (
    <>
      <Text>{position}</Text>
      <Button title="保留阅读位置" onPress={() => setPosition('第 3 页 · 只看楼主')} />
      <Button title="编辑主帖" onPress={open} />
    </>
  );
}
beforeEach(() => {
  appQueryClient.clear();
  mockRuntime.sessionEpochs.linuxdo = 0;
  mockRuntime.getTopic.mockReset();
});
it.each([false, true])('保存后返回保留的主题；旧 epoch 的迟到回读不覆盖缓存（换号=%s）', async (changeAccount) => {
  appQueryClient.setQueryData(key, previous);
  const listKey = ['forum', 'all', 'feed', {}];
  appQueryClient.setQueryData(listKey, { pages: [] });
  let finish!: (value: unknown) => void;
  mockRuntime.getTopic.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  const view = await render(
    <QueryTestWrapper>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen name="Topic">
            {({ navigation }) => (
              <Topic
                open={() => navigation.push('TopicComposer', { kind: 'edit', source: 'linuxdo', topicId: '123' })}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="TopicComposer" component={TopicComposerRoute} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryTestWrapper>
  );
  await fireEvent.press(view.getByText('保留阅读位置'));
  await fireEvent.press(view.getByText('编辑主帖'));
  await fireEvent.press(view.getByText('完成模拟保存'));
  await waitFor(() => expect(mockRuntime.getTopic).toHaveBeenCalledTimes(1));
  expect(view.getByText('第 3 页 · 只看楼主')).toBeTruthy();
  expect(mockRuntime.getTopic).toHaveBeenCalledWith(expect.objectContaining({ trackVisit: false, id: '123' }));
  if (changeAccount) mockRuntime.sessionEpochs.linuxdo = 1;
  await act(async () => finish({ ...previous, title: '新标题', content: '新正文', replies: [], replyNextPage: 1 }));
  await waitFor(() =>
    expect(appQueryClient.getQueryData(key)).toEqual(
      changeAccount ? previous : { ...previous, title: '新标题', content: '新正文' }
    )
  );
  expect(appQueryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
});
