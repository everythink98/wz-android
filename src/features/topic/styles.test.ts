import { describe, expect, it, vi } from 'vitest';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { resolveReaderStyleSettings, createTheme } from '@/ui/theme/tokens';
import { createTopicStyles, createTopicTableStyles } from './styles';

vi.mock('react-native', () => ({
  StatusBar: { currentHeight: 0 },
  StyleSheet: {
    create: <T>(styles: T) => styles,
    hairlineWidth: 0.5
  }
}));

describe('topic styles', () => {
  it('lets FlashList stretch its width probe while rows keep content centered', () => {
    const settings = resolveReaderStyleSettings(createEmptyReaderData().settings);
    const styles = createTopicStyles(createTheme(settings), resolveReaderStyleSettings(settings));

    expect(styles.topicContentInner).not.toHaveProperty('alignItems');
    expect(styles.topicListItemFrame).toMatchObject({ width: '100%', alignItems: 'center' });
  });

  it('gives the table perimeter the same single stroke as its cells', () => {
    const settings = resolveReaderStyleSettings(createEmptyReaderData().settings);
    const theme = createTheme(settings);

    expect(createTopicTableStyles(theme).htmlTableFrame).toMatchObject({
      borderColor: theme.line,
      borderWidth: 1
    });
  });
});
