import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  StyleSheet: {
    absoluteFillObject: {}
  },
  Text: 'Text',
  View: 'View'
}));

vi.mock('expo-image', () => ({
  Image: 'Image'
}));

vi.mock('react-native-svg', () => ({
  SvgXml: 'SvgXml'
}));

describe('Android avatar initials', () => {
  it('keeps emoji initials as complete characters', async () => {
    const { avatarInitial } = (await import('@/components/Avatar')) as typeof import('@/components/Avatar') & {
      avatarInitial?: (name?: string) => string;
    };

    expect(avatarInitial?.('🔥妖火')).toBe('🔥');
    expect(avatarInitial?.('👨‍💻dev')).toBe('👨‍💻');
    expect(avatarInitial?.('张三')).toBe('张');
    expect(avatarInitial?.('alice')).toBe('A');
    expect(avatarInitial?.('  ')).toBe('?');
    expect(avatarInitial?.()).toBe('?');
  });
});
