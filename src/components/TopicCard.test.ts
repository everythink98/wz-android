import { describe, expect, it, vi } from 'vitest';
import { topicCardPropsAreEqual } from './TopicCard';
import type { Topic } from '../types';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View'
}));

vi.mock('@shopify/flash-list', () => ({
  useMappingHelper: () => ({ getMappingKey: (_item: unknown, index: number) => String(index) })
}));

vi.mock('lucide-react-native', () => ({
  Eye: () => null,
  MessageCircle: () => null
}));

vi.mock('./Avatar', () => ({
  Avatar: () => null
}));

const topic: Topic = {
  source: 'yaohuo',
  id: '66',
  title: '妖火主题',
  author: '火友',
  category: '妖火茶馆',
  url: 'https://yaohuo.me/bbs-66.html',
  createdAt: '2026-05-20T02:30:00.000Z',
  displayTimeText: '2026-05-20 10:30',
  replyCount: 0
};

const props = {
  topic,
  readerState: { favorite: false, read: false, listDensity: 'standard' },
  styles: {},
  theme: {},
  onOpenTopic: () => undefined
} as unknown as Parameters<typeof topicCardPropsAreEqual>[0];

describe('topicCardPropsAreEqual', () => {
  it('re-renders when the displayed source time changes', () => {
    expect(topicCardPropsAreEqual(props, {
      ...props,
      topic: {
        ...topic,
        displayTimeText: '2026-05-20 18:30'
      }
    })).toBe(false);
  });

  it.each([
    ['url', 'https://yaohuo.me/bbs-67.html'],
    ['categoryId', 'tea-house'],
    ['authorId', 'user-2'],
    ['authorUrl', 'https://yaohuo.me/user-2']
  ] as const)('re-renders when the navigation field %s changes', (field, value) => {
    expect(topicCardPropsAreEqual(props, {
      ...props,
      topic: { ...topic, [field]: value }
    })).toBe(false);
  });
});
