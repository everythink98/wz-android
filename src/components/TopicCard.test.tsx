import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View'
}));

vi.mock('lucide-react-native', () => ({
  Eye: () => null,
  MessageCircle: () => null
}));

vi.mock('@shopify/flash-list', () => ({
  useMappingHelper: () => ({
    getMappingKey: (key: string, index: number) => `${key}:${index}`
  })
}));

vi.mock('./Avatar', () => ({
  Avatar: () => null
}));

vi.mock('../theme', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../theme')>()),
  androidRipple: () => undefined
}));

import { topicCardPropsAreEqual } from './TopicCard';
import type { Topic } from '../types';

const topic: Topic = {
  source: 'nodeseek',
  id: '1',
  title: 'title',
  author: 'alice',
  category: '日常',
  url: 'https://www.nodeseek.com/post-1-1',
  createdAt: '2026-06-01T00:00:00.000Z',
  replyCount: 2,
  tags: ['tag']
};

const props = {
  highlightQuery: '',
  onOpenTopic: vi.fn(),
  readerState: { favorite: false, listDensity: 'standard' as const, read: false },
  styles: {},
  theme: {},
  topic
};

describe('TopicCard memo comparison', () => {
  it('keeps equivalent topic and reader state objects from re-rendering', () => {
    expect(topicCardPropsAreEqual(props as never, {
      ...props,
      readerState: { favorite: false, listDensity: 'standard', read: false },
      topic: { ...topic, tags: ['tag'] }
    } as never)).toBe(true);
  });

  it('re-renders when visible state changes', () => {
    expect(topicCardPropsAreEqual(props as never, {
      ...props,
      readerState: { favorite: true, listDensity: 'standard', read: false },
      topic
    } as never)).toBe(false);
  });
});
