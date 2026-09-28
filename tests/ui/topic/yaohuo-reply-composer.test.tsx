import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type ReactNode, useState } from 'react';
import { DeviceEventEmitter, Keyboard, StyleSheet, TextInput, View } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { YaohuoReplyComposer } from '@/ui/composer/YaohuoReplyComposer';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { act, fireEvent, render, waitFor } from '../render';

const mockInputHandle = { blur: jest.fn(), focus: jest.fn(), setSelection: jest.fn() };
const originalSetSelection = TextInput.prototype.setSelection;
const originalFocus = TextInput.prototype.focus;
const originalBlur = TextInput.prototype.blur;
beforeAll(() => {
  TextInput.prototype.setSelection = mockInputHandle.setSelection;
  TextInput.prototype.focus = mockInputHandle.focus;
  TextInput.prototype.blur = mockInputHandle.blur;
});
afterAll(() => {
  TextInput.prototype.setSelection = originalSetSelection;
  TextInput.prototype.focus = originalFocus;
  TextInput.prototype.blur = originalBlur;
});

jest.mock('react-native-gesture-handler', () => ({
  ScrollView: require('react-native').ScrollView
}));

function Harness({
  actionBusy = false,
  uploadingImage = false,
  format = 'ubb',
  onSubmit = jest.fn(),
  onUploadImage,
  status
}: {
  actionBusy?: boolean;
  uploadingImage?: boolean;
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
        awaitKeyboardSettled={async () => undefined}
        actionBusy={actionBusy}
        uploadingImage={uploadingImage}
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
  it.each([
    { presentation: 'sheet', label: '表情', item: '无表情' },
    { presentation: 'embedded', label: '表情', item: '无表情' },
    { presentation: 'embedded', label: '文字格式', item: '粗体' }
  ] as const)('waits for panel handoff before opening $presentation $label', async ({ presentation, label, item }) => {
    const hidden = Promise.withResolvers<void>();
    const awaitKeyboardSettled = jest.fn(() => hidden.promise);
    const onPanelChange = jest.fn();
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      const view = await render(
        <YaohuoReplyComposer
          actionBusy={false}
          content="保留正文"
          presentation={presentation}
          inputAccessibilityLabel="正文"
          onContentChange={jest.fn()}
          onPanelChange={onPanelChange}
          awaitKeyboardSettled={awaitKeyboardSettled}
        />
      );
      await fireEvent.press(view.getByLabelText(label));
      expect(awaitKeyboardSettled).toHaveBeenCalledTimes(1);
      expect(onPanelChange).toHaveBeenLastCalledWith(true);
      onPanelChange.mockClear();
      expect(view.queryByLabelText(item)).toBeNull();
      expect(view.getByLabelText('正文').props.editable).toBe(true);
      expect(mockInputHandle.blur).not.toHaveBeenCalled();
      expect(dismiss).not.toHaveBeenCalled();
      await act(() => hidden.resolve());
      expect(view.getByLabelText(item)).toBeTruthy();
      expect(mockInputHandle.blur).toHaveBeenCalledTimes(1);
      expect(dismiss).not.toHaveBeenCalled();
      expect(onPanelChange).not.toHaveBeenCalledWith(false);
      await fireEvent.press(view.getByLabelText(label));
      expect(view.queryByLabelText(item)).toBeNull();
      expect(onPanelChange).toHaveBeenLastCalledWith(false);
      expect(awaitKeyboardSettled).toHaveBeenCalledTimes(1);
    } finally {
      dismiss.mockRestore();
    }
  });
  it('preserves input when panel handoff is rejected and allows a retry', async () => {
    const awaitKeyboardSettled = jest.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('键盘交接失败'));
    const onPanelChange = jest.fn();
    const view = await render(
      <YaohuoReplyComposer
        actionBusy={false}
        content="保留正文"
        onContentChange={jest.fn()}
        onPanelChange={onPanelChange}
        awaitKeyboardSettled={awaitKeyboardSettled}
      />
    );
    await fireEvent.press(view.getByLabelText('表情'));
    expect(view.queryByLabelText('无表情')).toBeNull();
    expect(mockInputHandle.blur).not.toHaveBeenCalled();
    expect(view.getByText('键盘交接失败')).toBeTruthy();
    expect(onPanelChange).toHaveBeenLastCalledWith(false);
    awaitKeyboardSettled.mockResolvedValueOnce();
    await fireEvent.press(view.getByLabelText('表情'));
    expect(view.getByLabelText('无表情')).toBeTruthy();
    expect(view.queryByText('键盘交接失败')).toBeNull();
  });
  it.each(['close', 'dismiss', 'busy', 'disabled', 'focus', 'unmount'] as const)(
    'discards panel handoff after %s even when the owner becomes usable again',
    async (boundary) => {
      const hidden = Promise.withResolvers<void>();
      const awaitKeyboardSettled = jest.fn(() => hidden.promise);
      const onPanelChange = jest.fn();
      const onOpenChange = jest.fn();
      const composer = (invalid = false) => (
        <YaohuoReplyComposer
          actionBusy={invalid && boundary === 'busy'}
          disabledReason={invalid && boundary === 'disabled' ? '暂不可编辑' : undefined}
          dismissPanels={invalid && boundary === 'dismiss'}
          content="保留正文"
          inputAccessibilityLabel="正文"
          presentation={boundary === 'close' ? 'sheet' : 'embedded'}
          onContentChange={jest.fn()}
          onPanelChange={onPanelChange}
          onOpenChange={onOpenChange}
          awaitKeyboardSettled={awaitKeyboardSettled}
        />
      );
      const view = await render(composer());
      await fireEvent.press(view.getByLabelText('表情'));
      if (boundary === 'close') await fireEvent.press(view.getByLabelText('收起回复'));
      else if (boundary === 'focus') await fireEvent(view.getByLabelText('正文'), 'focus');
      else if (boundary === 'unmount') await view.unmount();
      else {
        await view.rerender(composer(true));
        await view.rerender(composer());
      }
      if (boundary !== 'unmount') expect(onPanelChange).toHaveBeenLastCalledWith(false);
      onPanelChange.mockClear();
      mockInputHandle.blur.mockClear();
      await act(() => hidden.resolve());
      expect(onPanelChange).not.toHaveBeenCalledWith(true);
      expect(mockInputHandle.blur).not.toHaveBeenCalled();
      if (boundary !== 'unmount') expect(view.queryByLabelText('无表情')).toBeNull();
    }
  );
  it('keeps one panel handoff for repeated and competing toolbar presses', async () => {
    const hidden = Promise.withResolvers<void>();
    const awaitKeyboardSettled = jest.fn(() => hidden.promise);
    const view = await render(
      <YaohuoReplyComposer
        actionBusy={false}
        content="保留正文"
        presentation="embedded"
        onContentChange={jest.fn()}
        awaitKeyboardSettled={awaitKeyboardSettled}
      />
    );
    await fireEvent.press(view.getByLabelText('表情'));
    await fireEvent.press(view.getByLabelText('表情'));
    await fireEvent.press(view.getByLabelText('文字格式'));
    expect(awaitKeyboardSettled).toHaveBeenCalledTimes(1);
    expect(mockInputHandle.blur).not.toHaveBeenCalled();
    await act(() => hidden.resolve());
    expect(view.getByLabelText('无表情')).toBeTruthy();
    expect(view.queryByLabelText('粗体')).toBeNull();
    expect(mockInputHandle.blur).toHaveBeenCalledTimes(1);
  });
  it.each(['sheet', 'embedded'] as const)(
    'keeps the %s input attached until keyboard handoff succeeds',
    async (presentation) => {
      const hidden = Promise.withResolvers<void>();
      const onUploadImage = jest.fn(async () => undefined);
      mockInputHandle.blur.mockClear();
      const view = await render(
        <YaohuoReplyComposer
          actionBusy={false}
          content="保留正文"
          presentation={presentation}
          inputAccessibilityLabel="正文"
          onContentChange={jest.fn()}
          onUploadImage={onUploadImage}
          awaitKeyboardSettled={() => hidden.promise}
        />
      );
      await fireEvent.press(view.getByLabelText('图片'));
      expect(view.getByLabelText('正文').props.editable).toBe(true);
      expect(mockInputHandle.blur).not.toHaveBeenCalled();
      expect(onUploadImage).not.toHaveBeenCalled();
      await act(() => hidden.resolve());
      expect(onUploadImage).toHaveBeenCalledTimes(1);
      expect(mockInputHandle.blur).toHaveBeenCalledTimes(1);
    }
  );
  it('keeps the picker closed when its keyboard handoff fails', async () => {
    const onUploadImage = jest.fn();
    const view = await render(
      <YaohuoReplyComposer
        actionBusy={false}
        content="保留正文"
        presentation="embedded"
        onContentChange={jest.fn()}
        onUploadImage={onUploadImage}
        awaitKeyboardSettled={async () => {
          throw new Error('键盘交接失败');
        }}
      />
    );
    await fireEvent.press(view.getByLabelText('图片'));
    expect(onUploadImage).not.toHaveBeenCalled();
    expect(view.getByText('键盘交接失败')).toBeTruthy();
  });
  it('inserts an embedded image at the captured selection once without reopening input', async () => {
    let complete!: (markup: string | undefined) => void;
    const onUploadImage = jest.fn(
      () =>
        new Promise<string | undefined>((resolve) => {
          complete = resolve;
        })
    );
    const onContentChange = jest.fn();
    const view = await render(
      <YaohuoReplyComposer
        awaitKeyboardSettled={async () => undefined}
        actionBusy={false}
        content={'前文\n\n后文'}
        presentation="embedded"
        inputAccessibilityLabel="新帖正文"
        onContentChange={onContentChange}
        onUploadImage={onUploadImage}
      />
    );
    const input = view.getByLabelText('新帖正文');
    await fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 2, end: 2 } } });
    await fireEvent.press(view.getByLabelText('图片'));
    expect(input.props.editable).toBe(false);
    await fireEvent.press(view.getByLabelText('上传中…'));
    expect(onUploadImage).toHaveBeenCalledTimes(1);
    const animationFrame = jest.spyOn(globalThis, 'requestAnimationFrame');
    try {
      await act(async () => complete('\n\n[img]https://example.com/a.png[/img]'));
      expect(onContentChange).toHaveBeenCalledTimes(1);
      expect(onContentChange).toHaveBeenCalledWith('前文\n\n[img]https://example.com/a.png[/img]\n\n后文');
      expect(input.props.editable).toBe(true);
      expect(animationFrame).not.toHaveBeenCalled();
    } finally {
      animationFrame.mockRestore();
    }
  });
  it.each(['cancel', 'failure'] as const)('preserves embedded content after an image %s', async (outcome) => {
    let complete!: (markup: undefined) => void;
    let fail!: (error: Error) => void;
    const onContentChange = jest.fn();
    const view = await render(
      <YaohuoReplyComposer
        awaitKeyboardSettled={async () => undefined}
        actionBusy={false}
        content="保留正文"
        presentation="embedded"
        inputAccessibilityLabel="新帖正文"
        onContentChange={onContentChange}
        onUploadImage={() =>
          new Promise<undefined>((resolve, reject) => {
            complete = resolve;
            fail = reject;
          })
        }
      />
    );
    await fireEvent.press(view.getByLabelText('图片'));
    await act(async () => (outcome === 'cancel' ? complete(undefined) : fail(new Error('上传被拒绝'))));
    expect(onContentChange).not.toHaveBeenCalled();
    expect(view.getByLabelText('新帖正文').props.editable).toBe(true);
    if (outcome === 'failure') expect(view.getByText('上传被拒绝')).toBeTruthy();
  });
  it.each(['content', 'draft', 'unmount'] as const)('ignores an embedded image after its %s changes', async (owner) => {
    let complete!: (markup: string) => void;
    const onContentChange = jest.fn();
    const onUploadImage = () =>
      new Promise<string>((resolve) => {
        complete = resolve;
      });
    const composer = (key: string, content: string) => (
      <YaohuoReplyComposer
        awaitKeyboardSettled={async () => undefined}
        key={key}
        actionBusy={false}
        content={content}
        presentation="embedded"
        inputAccessibilityLabel="新帖正文"
        onContentChange={onContentChange}
        onUploadImage={onUploadImage}
      />
    );
    const view = await render(composer('old', '原正文'));
    await fireEvent.press(view.getByLabelText('图片'));
    if (owner === 'unmount') await view.unmount();
    else await view.rerender(composer(owner === 'draft' ? 'new' : 'old', owner === 'content' ? '改后正文' : '原正文'));
    await act(async () => complete('[img]https://example.com/late.png[/img]'));
    expect(onContentChange).not.toHaveBeenCalled();
    if (owner !== 'unmount') expect(view.getByLabelText('新帖正文').props.editable).toBe(true);
  });
  it('labels an image upload separately from sending while keeping both actions disabled', async () => {
    const onSubmit = jest.fn();
    const view = await render(<Harness actionBusy uploadingImage onSubmit={onSubmit} />);
    expect(view.queryByText('发送中…')).toBeNull();
    expect(view.getByLabelText('上传中…').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('上传中…'));
    expect(onSubmit).not.toHaveBeenCalled();
    await view.rerender(<Harness actionBusy onSubmit={onSubmit} />);
    expect(view.getByLabelText('发送中…').props.accessibilityState.disabled).toBe(true);
    expect(view.queryByText('上传中…')).toBeNull();
  });
  it('inserts an inline face at the current selection for new topics', async () => {
    const onContentChange = jest.fn();
    const view = await render(
      <YaohuoReplyComposer
        awaitKeyboardSettled={async () => undefined}
        actionBusy={false}
        content="甲乙丙"
        presentation="embedded"
        faceMode="inline"
        inputAccessibilityLabel="新帖正文"
        onContentChange={onContentChange}
      />
    );
    await fireEvent(view.getByLabelText('新帖正文'), 'selectionChange', {
      nativeEvent: { selection: { start: 1, end: 2 } }
    });
    await fireEvent.press(view.getByLabelText('表情'));
    expect(view.queryByLabelText('无表情')).toBeNull();
    await fireEvent.press(view.getByLabelText('淡定'));
    expect(onContentChange).toHaveBeenCalledWith(
      `甲[img]https://www.yaohuo.me/bbs/face/${encodeURIComponent('淡定.gif')}[/img]丙`
    );
  });
  it('embeds the native input and UBB tools without duplicate page actions', async () => {
    const onContentChange = jest.fn();
    const view = await render(
      <YaohuoReplyComposer
        awaitKeyboardSettled={async () => undefined}
        actionBusy={false}
        content="正文"
        presentation="embedded"
        inputAccessibilityLabel="新帖正文"
        onContentChange={onContentChange}
      />
    );
    expect(view.queryByLabelText('发送回复')).toBeNull();
    expect(view.queryByLabelText('收起回复')).toBeNull();
    expect(view.queryByText('回复')).toBeNull();
    const input = view.getByLabelText('新帖正文');
    expect(StyleSheet.flatten(input.props.style)).toMatchObject({
      flex: 1,
      maxHeight: undefined,
      borderWidth: 0,
      borderRadius: 0,
      paddingHorizontal: 16
    });
    expect(view.getByTestId('yaohuo-embedded-toolbar')).toBeTruthy();
    expect(view.queryByLabelText('粗体')).toBeNull();
    await fireEvent.press(view.getByLabelText('文字格式'));
    await fireEvent.press(view.getByLabelText('粗体'));
    expect(onContentChange).toHaveBeenCalledWith('正文[b]粗体[/b]');
    expect(view.getByLabelText('斜体')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('斜体'));
    expect(onContentChange).toHaveBeenLastCalledWith('正文[b]粗体[/b][i]斜体[/i]');
    expect(input.props.selection).toBeUndefined();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['ubb', 'plain-text'] as const)(
    'keeps %s typing current before the parent echoes it through the portal',
    async (format) => {
      const onContentChange = jest.fn();
      const composer = (content: string) => (
        <YaohuoReplyComposer actionBusy={false} content={content} format={format} onContentChange={onContentChange} />
      );
      const view = await render(composer('前后'));
      const input = view.getByPlaceholderText('输入回复内容');
      await fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 1, end: 1 } } });
      for (const value of ['前a后', '前ab后', '前abc后', '前ab后']) {
        await fireEvent.changeText(input, value);
        expect(input.props.value).toBe(value);
        expect(onContentChange).toHaveBeenLastCalledWith(value);
        expect(input.props.selection).toBeUndefined();
        await view.rerender(composer(value));
      }
      expect(mockInputHandle.setSelection).not.toHaveBeenCalled();
      await view.rerender(composer(''));
      expect(input.props.value).toBe('');
      await view.rerender(composer('恢复草稿'));
      expect(input.props.value).toBe('恢复草稿');
    }
  );

  it.each(['ubb', 'plain-text'] as const)('leaves the native cursor alone during %s IME updates', async (format) => {
    const view = await render(<Harness format={format} />);
    const input = view.getByPlaceholderText('输入回复内容');

    // IME selection and composing-text events can arrive in either order.
    await fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 1, end: 1 } } });
    for (const content of ['妖', '妖火连续输入', '妖火语音连续输入。', '妖火语音']) {
      await fireEvent.changeText(input, content);
      expect(input.props.value).toBe(content);
      expect(input.props.selection).toBeUndefined();
      await fireEvent(input, 'selectionChange', {
        nativeEvent: { selection: { start: content.length, end: content.length } }
      });
    }
    expect(mockInputHandle.setSelection).not.toHaveBeenCalled();
  });

  it.each(['ubb', 'plain-text'] as const)('keeps %s input focused when the IME hides its keyboard', async (format) => {
    const view = await render(<Harness format={format} />);
    const input = view.getByPlaceholderText('输入回复内容');
    await fireEvent(input, 'focus');
    await fireEvent.changeText(input, '语');
    await act(() => DeviceEventEmitter.emit('keyboardDidHide', {}));

    expect(mockInputHandle.blur).not.toHaveBeenCalled();
    await fireEvent.changeText(input, '语音连续输入');
    expect(input.props.value).toBe('语音连续输入');
  });

  it('formats the native selection and moves the cursor only for explicit toolbar actions', async () => {
    const view = await render(<Harness />);
    const input = view.getByPlaceholderText('输入回复内容');
    await fireEvent.changeText(input, '甲乙丙');
    await fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 1, end: 2 } } });
    await fireEvent.press(view.getByLabelText('粗体'));
    expect(input.props.value).toBe('甲[b]乙[/b]丙');
    await waitFor(() => expect(mockInputHandle.setSelection).toHaveBeenLastCalledWith(9, 9));

    // The next toolbar action can precede a native selection callback.
    await fireEvent.press(view.getByLabelText('斜体'));
    expect(input.props.value).toBe('甲[b]乙[/b][i]斜体[/i]丙');
    await waitFor(() => expect(mockInputHandle.setSelection).toHaveBeenLastCalledWith(18, 18));
    expect(mockInputHandle.focus).toHaveBeenCalledTimes(2);

    await fireEvent.changeText(input, '');
    await fireEvent.press(view.getByLabelText('粗体'));
    expect(input.props.value).toBe('[b]粗体[/b]');
    await waitFor(() => expect(mockInputHandle.setSelection).toHaveBeenLastCalledWith(9, 9));
  });

  it('owns UBB formatting, Yaohuo faces and upload without any L/NS editor behavior', async () => {
    const onSubmit = jest.fn();
    const onUploadImage = jest.fn();
    const view = await render(<Harness onSubmit={onSubmit} onUploadImage={onUploadImage} />);
    const input = view.getByPlaceholderText('输入回复内容');

    await fireEvent.press(view.getByLabelText('粗体'));
    expect(input.props.value).toBe('[b]粗体[/b]');
    await fireEvent.press(view.getByLabelText('表情'));
    expect(mockInputHandle.blur).toHaveBeenCalledTimes(1);
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
