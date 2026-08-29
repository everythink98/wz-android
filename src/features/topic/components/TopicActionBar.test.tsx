import { describe, expect, it, vi } from 'vitest';
import React from 'react';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: {
    OS: 'android'
  },
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View'
}));

vi.mock('@/ui/controls/pressFeedback', () => ({
  triggerPressFeedback: vi.fn()
}));

function collectText(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') {
    return [String(node)];
  }
  if (!node || typeof node !== 'object') {
    return [];
  }
  const props = (node as { props?: { children?: unknown } }).props;
  const children = props?.children;
  if (Array.isArray(children)) {
    return children.flatMap(collectText);
  }
  return collectText(children);
}

describe('Android topic action buttons', () => {
  const styles = {
    buttonDisabled: {},
    detailActionButton: {},
    detailActionCompactTextBlock: {},
    detailActionCount: {},
    detailActionIconSlot: {},
    detailActionLabel: {},
    detailActionLabelActive: {},
    detailActionTextBlock: {},
    replyCompactActionButton: {},
    replyDetailActionButton: {},
    topicPrimaryActionButton: {},
    topicPrimaryActionCount: {},
    topicPrimaryActionLabel: {}
  };
  const theme = {
    dark: false,
    background: '#fff',
    surface: '#fff',
    surface2: '#f7f7f7',
    line: '#ddd',
    lineStrong: '#ccc',
    ink: '#111',
    muted: '#666',
    primary: '#111111',
    primaryStrong: '#000000',
    primarySoft: 'rgba(17, 17, 17, 0.08)',
    mist: '#eef1ec',
    onPrimary: '#fff',
    onOverlay: '#fff',
    danger: '#b42318',
    warning: '#8a5a00',
    success: '#257a4f',
    favorite: '#facc15'
  };
  const Icon = () => null;

  it('keeps compact reply actions labeled with short counts and accessibility labels', async () => {
    const { DetailActionButton } = await import('./TopicActionBar');

    const element = DetailActionButton({
      accessibilityLabel: '点赞',
      compact: true,
      count: 100,
      icon: Icon as never,
      label: '赞',
      styles: styles as never,
      theme,
      onPress: vi.fn()
    });

    expect(element.props.accessibilityLabel).toBe('点赞');
    expect(collectText(element)).toContain('赞');
    expect(collectText(element)).toContain('99+');
    expect(collectText(element)).not.toContain('100');
  });
});
