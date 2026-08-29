import { describe, expect, it, jest } from '@jest/globals';
import React, { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { YaohuoReplyComposer } from '@/ui/composer/YaohuoReplyComposer';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { fireEvent, render } from '../render';

jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetTextInput: (require('react') as typeof React).forwardRef(function BottomSheetTextInput(
    props: Record<string, unknown>,
    ref
  ) {
    void ref;
    return (require('react') as typeof React).createElement(require('react-native').TextInput, props);
  })
}));

jest.mock('react-native-gesture-handler', () => ({
  ScrollView: require('react-native').ScrollView
}));

function Harness({
  actionBusy = false,
  format = 'ubb',
  onSubmit = jest.fn(),
  onUploadImage,
  status
}: {
  actionBusy?: boolean;
  format?: 'ubb' | 'plain-text';
  onSubmit?: () => void;
  onUploadImage?: () => void;
  status?: string;
}) {
  const [content, setContent] = useState('');
  const [face, setFace] = useState('');
  return (
    <View>
      <YaohuoReplyComposer
        actionBusy={actionBusy}
        content={content}
        face={face}
        format={format}
        placeholder="输入回复内容"
        status={status}
        onContentChange={setContent}
        onFaceChange={setFace}
        onOpenChange={jest.fn()}
        onSubmit={onSubmit}
        onUploadImage={onUploadImage}
      />
    </View>
  );
}

describe('Yaohuo reply composer', () => {
  it('owns UBB formatting, Yaohuo faces and upload without any L/NS editor behavior', async () => {
    const onSubmit = jest.fn();
    const onUploadImage = jest.fn();
    const view = await render(<Harness onSubmit={onSubmit} onUploadImage={onUploadImage} />);
    const input = view.getByPlaceholderText('输入回复内容');

    await fireEvent.press(view.getByLabelText('B'));
    expect(input.props.value).toBe('[b]粗体[/b]');
    await fireEvent.press(view.getByLabelText('表情'));
    await fireEvent.press(view.getByLabelText('踩'));
    expect(view.getByText('表情：踩')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('图片'));
    expect(onUploadImage).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(view.queryByLabelText('插入')).toBeNull();
  });

  it('keeps Yaohuo private messages plain-text and blocks empty or busy submission', async () => {
    const onSubmit = jest.fn();
    const view = await render(<Harness format="plain-text" onSubmit={onSubmit} />);

    expect(view.queryByLabelText('B')).toBeNull();
    expect(view.queryByLabelText('表情')).toBeNull();
    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(view.getByPlaceholderText('输入回复内容'), '私信正文');
    await fireEvent.press(view.getByLabelText('发送回复'));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await view.rerender(<Harness actionBusy format="plain-text" status="正在提交回复…" onSubmit={onSubmit} />);
    expect(view.getByText('发送中…')).toBeTruthy();
    expect(view.getByLabelText('发送中…').props.accessibilityState.disabled).toBe(true);
    expect(view.getByText('正在提交回复…').props.accessibilityLiveRegion).toBe('polite');
  });

  it('keeps the Yaohuo toolbar reachable at 130%', async () => {
    const settings = { ...createEmptyReaderData().settings, fontScale: 1.3 };
    function Wrapper({ children }: { children: ReactNode }) {
      return <ReaderStyleProvider value={{ settings, theme: createTheme(settings) }}>{children}</ReaderStyleProvider>;
    }
    const view = await render(<Harness onUploadImage={jest.fn()} />, { wrapper: Wrapper });
    const toolbar = view.getByTestId('yaohuo-reply-composer-toolbar');
    const toolbarStyle = StyleSheet.flatten(toolbar.props.contentContainerStyle);

    expect(toolbar.props.horizontal).toBe(true);
    expect(toolbar.props.showsHorizontalScrollIndicator).toBe(false);
    expect(toolbarStyle.flexDirection).toBe('row');
    expect(view.getByLabelText('列表')).toBeTruthy();
  });
});
