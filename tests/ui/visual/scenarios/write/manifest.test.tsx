import React from 'react';

jest.mock('@shopify/flash-list', () => ({
  useMappingHelper: () => ({ getMappingKey: (value: string | number) => String(value) })
}));

jest.mock('@gorhom/bottom-sheet', () => {
  const { TextInput } = require('react-native') as typeof import('react-native');
  return { BottomSheetTextInput: TextInput };
});

jest.mock('react-native-gesture-handler', () => {
  const { ScrollView } = require('react-native') as typeof import('react-native');
  return { ScrollView };
});

jest.mock('@/ui/sheets/ComposerBottomSheet', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    ComposerBottomSheet: ({
      children,
      visible
    }: {
      children: (focusSignal: number) => React.ReactNode;
      visible: boolean;
    }) => (visible ? ReactModule.createElement(View, { testID: 'visual-composer-sheet' }, children(1)) : null)
  };
});

import { render } from '../../../render';
import { writeVisualScenarios } from './manifest';

function renderScenario(id: string) {
  const scenario = writeVisualScenarios.find((candidate) => candidate.id === id);
  if (!scenario || scenario.kind !== 'rendered') throw new Error(`Missing rendered scenario: ${id}`);
  return render(scenario.render());
}

describe('write visual scenarios', () => {
  it('classifies all WRITE capabilities with stable unique IDs', () => {
    expect(new Set(writeVisualScenarios.map(({ id }) => id)).size).toBe(writeVisualScenarios.length);
    expect(new Set(writeVisualScenarios.flatMap(({ capabilityIds }) => capabilityIds))).toEqual(
      new Set(['WRITE-01', 'WRITE-02', 'WRITE-03', 'WRITE-04', 'WRITE-05', 'WRITE-06'])
    );
  });

  it('renders the three production composer variants and busy state', async () => {
    const nodeSeek = await renderScenario('write.composer.nodeseek.new');
    expect(nodeSeek.getByText('回复')).toBeTruthy();
    expect(nodeSeek.getByLabelText('富文本').props.accessibilityState.selected).toBe(true);
    expect(nodeSeek.getByLabelText('全屏')).toBeTruthy();
    expect(nodeSeek.getByTestId('structured-composer-webview')).toBeTruthy();
    await nodeSeek.unmount();

    const linuxdo = await renderScenario('write.composer.linuxdo.edit');
    expect(linuxdo.getByText('编辑 #8')).toBeTruthy();
    expect(linuxdo.getByLabelText('保存编辑')).toBeTruthy();
    await linuxdo.unmount();

    const yaohuo = await renderScenario('write.composer.yaohuo.floor');
    expect(yaohuo.getByText('回复 @示例用户 · #12')).toBeTruthy();
    expect(yaohuo.getByTestId('yaohuo-reply-composer-toolbar')).toBeTruthy();
    expect(yaohuo.getByPlaceholderText('输入楼层回复内容')).toBeTruthy();
    await yaohuo.unmount();

    const pending = await renderScenario('write.composer.yaohuo.pending');
    expect(pending.getByLabelText('发送中…').props.accessibilityState.disabled).toBe(true);
    expect(pending.getByPlaceholderText('输入回复内容').props.editable).toBe(false);
    await pending.unmount();
  });

  it('renders available, confirmed, and read-only poll states with TopicPolls', async () => {
    const available = await renderScenario('write.poll.nodeseek.available');
    expect(available.getByText('可投票')).toBeTruthy();
    expect(available.getByLabelText('提交投票').props.accessibilityState.disabled).toBe(true);
    await available.unmount();

    const voted = await renderScenario('write.poll.nodeseek.voted');
    expect(voted.getAllByText('已投票')).not.toHaveLength(0);
    expect(voted.getByText('7 人参与')).toBeTruthy();
    await voted.unmount();

    const readonly = await renderScenario('write.poll.v2ex.readonly');
    expect(readonly.getByText('只读结果')).toBeTruthy();
    expect(readonly.queryByText('提交投票')).toBeNull();
    await readonly.unmount();
  });

  it('keeps native and non-visual boundaries documented instead of rendering substitutes', () => {
    const classified = writeVisualScenarios.filter(({ kind }) => kind !== 'rendered');
    expect(classified).not.toHaveLength(0);
    expect(classified.every(({ note }) => Boolean(note))).toBe(true);
    expect(classified.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'write.reply.delete-confirmation',
        'write.interactions.outcome-transition',
        'write.upload.file-picker',
        'write.composer.device-interaction',
        'write.stardust.reader-payment',
        'write.mutation.session-ownership'
      ])
    );
  });
});
