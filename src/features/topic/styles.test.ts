import { describe, expect, it, vi } from 'vitest';
import { createEmptyReaderData, type ReaderSettings } from '@/domain/reader/readerData';
import { createTheme } from '@/ui/theme/tokens';
import { createTopicStyles } from './styles';

vi.mock('react-native', () => ({
  StatusBar: { currentHeight: 0 },
  StyleSheet: {
    create: <T>(styles: T) => styles,
    hairlineWidth: 0.5
  }
}));

describe('topic styles', () => {
  it('lets FlashList stretch its width probe while rows keep content centered', () => {
    const settings: ReaderSettings = {
      theme: 'light',
      fontScale: 1,
      nodeSeekRecoveryThreshold: 1,
      lineHeight: 'standard',
      contentWidth: 'standard',
      fontFamily: 'sans',
      listDensity: 'standard',
      contentSources: createEmptyReaderData().settings.contentSources
    };
    const styles = createTopicStyles(createTheme(settings), settings);

    expect(styles.topicContentInner).not.toHaveProperty('alignItems');
    expect(styles.topicListItemFrame).toMatchObject({ width: '100%', alignItems: 'center' });
  });

  it('gives the table perimeter the same single stroke as its cells', () => {
    const settings: ReaderSettings = {
      theme: 'light',
      fontScale: 1,
      nodeSeekRecoveryThreshold: 1,
      lineHeight: 'standard',
      contentWidth: 'standard',
      fontFamily: 'sans',
      listDensity: 'standard',
      contentSources: createEmptyReaderData().settings.contentSources
    };
    const theme = createTheme(settings);

    expect(createTopicStyles(theme, settings).htmlTableFrame).toMatchObject({
      borderColor: theme.line,
      borderWidth: 1
    });
  });
});
