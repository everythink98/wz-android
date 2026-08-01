import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ReplyEditTarget, ReplyTarget } from '@/features/topic/model/types';
import type { DiscourseEmojiUrlMap } from '@/discourseReactions';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReplyComposer } from '@/screens/topic/ReplyComposer';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from './styleFixture';
import type { Source } from '@/domain/forum/models';

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactModule = require('react') as typeof React;
  const { TextInput, View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    BottomSheetFlatList: ({
      data = [],
      keyExtractor,
      renderItem,
      ...props
    }: {
      data?: unknown[];
      keyExtractor?: (item: unknown, index: number) => string;
      renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
    } & Record<string, unknown>) =>
      ReactModule.createElement(
        NativeView,
        props,
        ...data.map((item, index) =>
          ReactModule.createElement(
            NativeView,
            { key: keyExtractor?.(item, index) ?? index },
            renderItem?.({ item, index })
          )
        )
      ),
    BottomSheetTextInput: ReactModule.forwardRef(function BottomSheetTextInput(props: Record<string, unknown>, ref) {
      void ref;
      return ReactModule.createElement(TextInput, props);
    })
  };
});

jest.mock('react-native-gesture-handler', () => ({
  ScrollView: require('react-native').ScrollView
}));

jest.mock('expo-image', () => ({ Image: () => null }));

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const submitReply = jest.fn();

function ReplyHarness({
  actionBusy = false,
  initialContent = '',
  discourseEmojiUrls,
  onUploadReplyImage,
  replyEditTarget = null,
  replyTarget = null,
  source = 'nodeseek'
}: {
  actionBusy?: boolean;
  initialContent?: string;
  discourseEmojiUrls?: DiscourseEmojiUrlMap;
  onUploadReplyImage?: () => void;
  replyEditTarget?: ReplyEditTarget | null;
  replyTarget?: ReplyTarget | null;
  source?: Source;
} = {}) {
  const [visible, setVisible] = useState(true);
  const [content, setContent] = useState(initialContent);
  const [face, setFace] = useState('');
  return (
    <View>
      {visible ? (
        <ReplyComposer
          actionBusy={actionBusy}
          discourseEmojiUrls={discourseEmojiUrls}
          replyContent={content}
          replyEditTarget={replyEditTarget}
          replyFace={face}
          replyTarget={replyTarget}
          source={source}
          styles={styles}
          theme={theme}
          onReplyComposerOpenChange={setVisible}
          onReplyContentChange={setContent}
          onReplyFaceChange={setFace}
          onSubmitReply={submitReply}
          onUploadReplyImage={onUploadReplyImage}
        />
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="打开回复" onPress={() => setVisible(true)}>
          <Text>打开回复</Text>
        </Pressable>
      )}
    </View>
  );
}

describe('Reply composer local behavior', () => {
  it('blocks empty and in-flight submissions along with close and formatting actions', async () => {
    submitReply.mockClear();
    const view = await render(<ReplyHarness />);

    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('发送回复'));
    expect(submitReply).not.toHaveBeenCalled();

    await fireEvent.changeText(view.getByPlaceholderText('输入回复内容'), '准备发送');
    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(false);

    await view.rerender(<ReplyHarness actionBusy />);
    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('收起回复').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('B').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('发送回复'));
    await fireEvent.press(view.getByLabelText('收起回复'));
    expect(submitReply).not.toHaveBeenCalled();
    expect(view.getByPlaceholderText('输入回复内容')).toBeTruthy();
  });

  it('opens the source image-upload path without submitting the reply', async () => {
    submitReply.mockClear();
    const onUploadReplyImage = jest.fn<() => void>();
    const view = await render(<ReplyHarness onUploadReplyImage={onUploadReplyImage} />);

    await fireEvent.press(view.getByLabelText('图片'));
    expect(onUploadReplyImage).toHaveBeenCalledTimes(1);
    expect(submitReply).not.toHaveBeenCalled();
  });

  it('keeps the controlled draft across close/reopen and submits only through the callback', async () => {
    submitReply.mockClear();
    const view = await render(<ReplyHarness />);
    await fireEvent.changeText(view.getByPlaceholderText('输入回复内容'), '本地草稿');
    expect(view.getByPlaceholderText('输入回复内容').props.value).toBe('本地草稿');

    await fireEvent.press(view.getByLabelText('收起回复'));
    expect(view.queryByPlaceholderText('输入回复内容')).toBeNull();
    await fireEvent.press(view.getByLabelText('打开回复'));
    expect(view.getByPlaceholderText('输入回复内容').props.value).toBe('本地草稿');

    await fireEvent.press(view.getByLabelText('发送回复'));
    expect(submitReply).toHaveBeenCalledTimes(1);
  });

  it('labels floor replies and edits with distinct targets, placeholders and submit actions', async () => {
    submitReply.mockClear();
    const replyView = await render(
      <ReplyHarness initialContent="楼层草稿" replyTarget={{ author: '@bob', commentId: 8, floor: 3 }} />
    );

    expect(replyView.getByText('回复 @bob · #3')).toBeTruthy();
    expect(replyView.getByPlaceholderText('输入楼层回复内容').props.value).toBe('楼层草稿');
    expect(replyView.getByLabelText('取消楼层回复')).toBeTruthy();
    await fireEvent.press(replyView.getByLabelText('发送回复'));
    expect(submitReply).toHaveBeenCalledTimes(1);

    await replyView.rerender(
      <ReplyHarness
        key="edit"
        initialContent="待编辑正文"
        replyEditTarget={{
          commentId: 9,
          contentMarkdown: '待编辑正文',
          floor: 4,
          topicId: '1',
          ticket: { source: 'linuxdo', identityKey: 'linuxdo:alice', sessionEpoch: 1 }
        }}
      />
    );
    expect(replyView.getByText('编辑 #4')).toBeTruthy();
    expect(replyView.getByPlaceholderText('编辑回复内容').props.value).toBe('待编辑正文');
    expect(replyView.getByLabelText('取消编辑')).toBeTruthy();
    await fireEvent.press(replyView.getByLabelText('保存编辑'));
    expect(submitReply).toHaveBeenCalledTimes(2);
  });

  it.each(['nodeseek', 'linuxdo', 'xiaoyinsi', 'yaohuo'] as const)(
    '[REG-XIAOYINSI-002] keeps the %s image upload entry on the local callback boundary',
    async (source) => {
      submitReply.mockClear();
      const onUploadReplyImage = jest.fn();
      const view = await render(<ReplyHarness source={source} onUploadReplyImage={onUploadReplyImage} />);

      await fireEvent.press(view.getByLabelText('图片'));
      expect(onUploadReplyImage).toHaveBeenCalledTimes(1);
      expect(submitReply).not.toHaveBeenCalled();
    }
  );

  it('renders and inserts each source-specific expression through controlled state', async () => {
    const linuxDoView = await render(
      <ReplyHarness discourseEmojiUrls={{ party_parrot: 'https://example.com/party.png' }} source="linuxdo" />
    );
    await fireEvent.press(linuxDoView.getByLabelText('表情'));
    expect(linuxDoView.getByLabelText('party parrot')).toBeTruthy();
    await fireEvent.press(linuxDoView.getByLabelText('party parrot'));
    expect(linuxDoView.getByPlaceholderText('输入回复内容').props.value).toBe(':party_parrot:');

    await linuxDoView.rerender(
      <ReplyHarness
        key="xiaoyinsi"
        discourseEmojiUrls={{ waving_hand: 'https://forum.xiaoyinsi.com/images/emoji/twitter/waving_hand.png?v=15' }}
        source="xiaoyinsi"
      />
    );
    await fireEvent.press(linuxDoView.getByLabelText('表情'));
    await fireEvent.press(linuxDoView.getByLabelText('waving hand'));
    expect(linuxDoView.getByPlaceholderText('输入回复内容').props.value).toBe(':waving_hand:');

    await linuxDoView.rerender(<ReplyHarness key="yaohuo" source="yaohuo" />);
    await fireEvent.press(linuxDoView.getByLabelText('表情'));
    await fireEvent.press(linuxDoView.getByLabelText('踩'));
    expect(linuxDoView.getByText('表情：踩')).toBeTruthy();
  });
});
