import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createRef } from 'react';
import { BackHandler, Keyboard, View } from 'react-native';
import { PortalHost } from '@gorhom/portal';
import { ComposerToolbar, type ComposerToolbarProps } from '@/ui/composer/ComposerToolbar';
import type { ComposerToolbarState } from '@/ui/composer/structuredComposerBridge';
import { act, fireEvent, render } from '../render';

const ready: ComposerToolbarState = {
  blockquote: false,
  bold: false,
  bulletList: false,
  code: false,
  codeBlock: false,
  heading: 0,
  italic: false,
  orderedList: false,
  strike: false,
  table: false,
  taskList: false,
  underline: false,
  link: false,
  imageBusy: false,
  builder: null,
  mode: 'rich'
};

function props(overrides: Partial<ComposerToolbarProps> = {}): ComposerToolbarProps {
  return {
    state: ready,
    site: 'nodeseek',
    intentKind: 'reply',
    disabled: false,
    onAction: jest.fn(),
    viewportRef: { current: null },
    hostRef: { current: null },
    menuHostName: 'toolbar-test',
    ...overrides
  };
}

function menuFixture(overrides: Partial<ComposerToolbarProps> = {}) {
  const p = props({ hostRef: createRef<View>(), viewportRef: createRef<View>(), ...overrides });
  const element = (next: Partial<ComposerToolbarProps> = {}) => (
    <View ref={p.hostRef}>
      <View ref={p.viewportRef} />
      <ComposerToolbar {...p} {...next} />
      <PortalHost name={next.menuHostName ?? p.menuHostName} />
    </View>
  );
  return { p, element };
}

function mockMeasurements(height = 120) {
  const measure = jest.spyOn(View.prototype, 'measure').mockImplementation((callback) => {
    callback(0, 56, 320, height, 0, 56);
  });
  const measureLayout = jest.spyOn(View.prototype, 'measureLayout').mockImplementation((_host, callback) => {
    callback(0, 56 + height, 320, 58);
  });
  return { measure, measureLayout };
}

describe('Composer native toolbar', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preserves reply action order and NodeSeek private-message restrictions', async () => {
    const p = props();
    const view = await render(<ComposerToolbar {...p} />);
    expect(view.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
      '表情',
      '图片',
      '粗体',
      '斜体',
      '段落与标题',
      '删除线',
      '链接',
      '引用',
      '代码',
      '列表选项',
      '代码块',
      '分隔线',
      '表格',
      '投票',
      'Stardust 收款'
    ]);
    for (const [label, action] of [
      ['表情', 'emoji'],
      ['图片', 'upload-image'],
      ['粗体', 'bold'],
      ['斜体', 'italic'],
      ['删除线', 'strike'],
      ['链接', 'link'],
      ['引用', 'quote'],
      ['代码', 'code'],
      ['代码块', 'code-block'],
      ['分隔线', 'divider'],
      ['表格', 'table'],
      ['投票', 'poll'],
      ['Stardust 收款', 'stardust']
    ]) {
      await fireEvent.press(view.getByRole('button', { name: label }));
      expect(p.onAction).toHaveBeenLastCalledWith(action);
    }
    const horizontalScroll = view.getByTestId('composer-toolbar').queryAll((node) => node.props.horizontal === true);
    expect(horizontalScroll).toHaveLength(1);
    expect(horizontalScroll[0]).toHaveProp('keyboardShouldPersistTaps', 'always');
    await view.rerender(<ComposerToolbar {...p} intentKind="private-message" />);
    expect(view.queryByRole('button', { name: '投票' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Stardust 收款' })).toBeNull();
  });

  it('exposes LinuxDo tools, selected formatting and source-mode state without blurring the editor', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const p = props({ site: 'linuxdo', state: { ...ready, bold: true, link: true, heading: 3 } });
    const view = await render(<ComposerToolbar {...p} />);
    expect(view.getByRole('button', { name: '粗体' })).toBeSelected();
    expect(view.getByRole('button', { name: '链接' })).toBeSelected();
    expect(view.getByText('标题 3')).toBeTruthy();
    for (const [label, action] of [
      ['下划线', 'underline'],
      ['正文工具', 'private'],
      ['动态模板', 'templates']
    ]) {
      await fireEvent.press(view.getByRole('button', { name: label }));
      expect(p.onAction).toHaveBeenLastCalledWith(action);
    }
    expect(view.queryByRole('button', { name: 'Stardust 收款' })).toBeNull();
    await view.rerender(<ComposerToolbar {...p} state={{ ...ready, mode: 'source' }} />);
    expect(view.getByRole('button', { name: '粗体' })).not.toBeSelected();
    expect(view.getByText('正文')).toBeTruthy();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it.each(['create-topic', 'edit-topic'] as const)(
    'keeps the five %s primary buttons and their actions',
    async (intentKind) => {
      const p = props({ intentKind, state: { ...ready, builder: 'format' } });
      const view = await render(<ComposerToolbar {...p} />);
      const labels = ['图片', '表情', '文字格式', '输入正文', '更多编辑工具'];
      expect(view.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual(labels);
      expect(view.getByRole('button', { name: '文字格式' })).toBeSelected();
      for (const [index, action] of ['upload-image', 'emoji', 'format', 'focus-editor', 'more'].entries()) {
        await fireEvent.press(view.getByRole('button', { name: labels[index] }));
        expect(p.onAction).toHaveBeenLastCalledWith(action);
      }
    }
  );

  it('blocks unavailable state, host-disabled actions and duplicate upload taps', async () => {
    const p = props({ state: null });
    const view = await render(<ComposerToolbar {...p} />);
    await fireEvent.press(view.getByRole('button', { name: '粗体' }));
    expect(p.onAction).not.toHaveBeenCalled();
    await view.rerender(<ComposerToolbar {...p} state={ready} disabled />);
    await fireEvent.press(view.getByRole('button', { name: '粗体' }));
    expect(p.onAction).not.toHaveBeenCalled();
    await view.rerender(<ComposerToolbar {...p} state={{ ...ready, imageBusy: true }} />);
    expect(view.getByRole('button', { name: '上传中…' })).toBeDisabled();
    expect(view.getByRole('button', { name: '上传中…' })).toBeBusy();
    await fireEvent.press(view.getByRole('button', { name: '上传中…' }));
    expect(p.onAction).not.toHaveBeenCalled();
    await view.rerender(<ComposerToolbar {...p} state={ready} />);
    expect(view.getByRole('button', { name: '图片' })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: false, busy: false })
    );
    await fireEvent.press(view.getByRole('button', { name: '图片' }));
    expect(p.onAction).toHaveBeenCalledWith('upload-image');
  });

  it('places a scrollable heading menu above the bar inside the measured editor without moving keyboard focus', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const measurement = mockMeasurements(120);
    const { p, element } = menuFixture({ state: { ...ready, heading: 3 } });
    const view = await render(element());
    expect(measurement.measure.mock.contexts.filter((context) => context === p.viewportRef.current)).toHaveLength(0);
    await fireEvent.press(view.getByRole('button', { name: '段落与标题' }));
    expect(measurement.measure.mock.contexts.filter((context) => context === p.viewportRef.current)).toHaveLength(1);
    expect(view.getByTestId('composer-toolbar-menu')).toHaveStyle({ top: 56, left: 8, width: 240, height: 120 });
    expect(view.getAllByRole('menuitem')).toHaveLength(7);
    expect(view.getByRole('menuitem', { name: '标题 3' })).toBeSelected();
    const scrolls = view.container.queryAll((node) => node.type.endsWith('ScrollView'));
    expect(scrolls).toHaveLength(2);
    for (const scroll of scrolls) {
      expect(scroll).toHaveProp('keyboardShouldPersistTaps', 'always');
      expect(scroll).toHaveProp('keyboardDismissMode', 'none');
    }
    expect(view.getByRole('menuitem', { name: '标题 6' })).toHaveStyle({ minHeight: 48 });
    await fireEvent.press(view.getByRole('menuitem', { name: '标题 6' }));
    expect(p.onAction).toHaveBeenCalledTimes(1);
    expect(p.onAction).toHaveBeenCalledWith('heading-6');
    expect(view.queryByTestId('composer-toolbar-menu')).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('caps the heading menu and maps every list choice while preserving selection state', async () => {
    mockMeasurements(500);
    const { p, element } = menuFixture({ state: { ...ready, orderedList: true } });
    const view = await render(element());
    await fireEvent.press(view.getByRole('button', { name: '段落与标题' }));
    expect(view.getByTestId('composer-toolbar-menu')).toHaveStyle({ height: 240 });
    await fireEvent.press(view.getByRole('button', { name: '关闭工具栏菜单' }));
    for (const [label, action] of [
      ['无序列表', 'list'],
      ['有序列表', 'ordered-list'],
      ['任务列表', 'task-list']
    ]) {
      await fireEvent.press(view.getByRole('button', { name: '列表选项' }));
      expect(view.getByRole('menuitem', { name: '有序列表' })).toBeSelected();
      expect(view.getByTestId('composer-toolbar-menu')).toHaveStyle({ height: 144 });
      await fireEvent.press(view.getByRole('menuitem', { name: label }));
      expect(p.onAction).toHaveBeenLastCalledWith(action);
      expect(view.queryByTestId('composer-toolbar-menu')).toBeNull();
    }
  });

  it('consumes Back to close only the local menu', async () => {
    mockMeasurements();
    const listener = jest.spyOn(BackHandler, 'addEventListener');
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const { p, element } = menuFixture();
    const view = await render(element());
    await fireEvent.press(view.getByRole('button', { name: '列表选项' }));
    const callback = listener.mock.calls.at(-1)?.[1];
    expect(callback).toBeDefined();
    await act(() => expect(callback?.({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true));
    expect(view.queryByTestId('composer-toolbar-menu')).toBeNull();
    expect(p.onAction).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<ComposerToolbarProps>]>([
    ['disabled', { disabled: true }],
    ['new document', { state: null }],
    ['mode', { state: { ...ready, mode: 'source' as const } }],
    ['builder', { state: { ...ready, builder: 'link' as const } }],
    ['site', { site: 'linuxdo' as const }],
    ['intent', { intentKind: 'private-message' as const }],
    ['host', { menuHostName: 'replacement-host' }]
  ])('discards a pending native measurement after %s changes', async (_name, change) => {
    const measurement = mockMeasurements();
    let finish: Parameters<View['measureLayout']>[1] | undefined;
    measurement.measureLayout.mockImplementation((_host, callback) => {
      finish = callback;
    });
    const { p, element } = menuFixture();
    const view = await render(element());
    await fireEvent.press(view.getByRole('button', { name: '段落与标题' }));
    expect(finish).toBeDefined();
    await view.rerender(element(change));
    await act(() => finish?.(0, 176, 320, 58));
    expect(view.queryByTestId('composer-toolbar-menu')).toBeNull();
    expect(p.onAction).not.toHaveBeenCalled();
  });

  it('closes an open menu when the host disables it or switches document mode', async () => {
    mockMeasurements();
    const { element } = menuFixture();
    const view = await render(element());
    await fireEvent.press(view.getByRole('button', { name: '段落与标题' }));
    expect(view.getByTestId('composer-toolbar-menu')).toBeTruthy();
    await view.rerender(element({ disabled: true }));
    expect(view.queryByTestId('composer-toolbar-menu')).toBeNull();
    await view.rerender(element());
    await fireEvent.press(view.getByRole('button', { name: '列表选项' }));
    await view.rerender(element({ state: { ...ready, mode: 'source' } }));
    expect(view.queryByTestId('composer-toolbar-menu')).toBeNull();
  });

  it('ignores an old measurement failure after a newer menu has opened', async () => {
    const measurement = mockMeasurements();
    let fail: Parameters<View['measureLayout']>[2];
    measurement.measureLayout.mockImplementationOnce((_host, _callback, onFail) => {
      fail = onFail;
    });
    const { element } = menuFixture();
    const view = await render(element());
    await fireEvent.press(view.getByRole('button', { name: '段落与标题' }));
    await fireEvent.press(view.getByRole('button', { name: '列表选项' }));
    expect(view.getByRole('menuitem', { name: '任务列表' })).toBeTruthy();
    await act(() => fail?.());
    expect(view.getByRole('menuitem', { name: '任务列表' })).toBeTruthy();
  });

  it('removes the popup when its native anchor moves during keyboard animation', async () => {
    mockMeasurements();
    const { element } = menuFixture();
    const view = await render(element());
    expect(view.getByTestId('composer-toolbar').props.onLayout).toBeUndefined();
    await fireEvent.press(view.getByRole('button', { name: '段落与标题' }));
    await fireEvent(view.getByTestId('composer-toolbar'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 176, width: 320, height: 58 } }
    });
    expect(view.getByTestId('composer-toolbar-menu')).toBeTruthy();
    await fireEvent(view.getByTestId('composer-toolbar'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 196, width: 320, height: 58 } }
    });
    expect(view.queryByTestId('composer-toolbar-menu')).toBeNull();
    expect(view.getByTestId('composer-toolbar').props.onLayout).toBeUndefined();
  });

  it('ignores viewport measurements that arrive after unmount', async () => {
    const measurement = mockMeasurements();
    let finish: Parameters<View['measure']>[0] | undefined;
    measurement.measure.mockImplementation((callback) => {
      finish = callback;
    });
    const { p, element } = menuFixture();
    const view = await render(element());
    await fireEvent.press(view.getByRole('button', { name: '段落与标题' }));
    expect(finish).toBeDefined();
    await view.unmount();
    await act(() => finish?.(0, 56, 320, 120, 0, 56));
    expect(view.queryByTestId('composer-toolbar-menu')).toBeNull();
    expect(p.onAction).not.toHaveBeenCalled();
  });
});
