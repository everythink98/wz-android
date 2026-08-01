import type { ReaderSettings } from '@/domain/reader/readerData';
import { createAppStyles } from '@/app/styles';
import { createMoreAccountStyles } from '@/features/more/accountStyles';
import { createLoginWebViewStyles } from '@/ui/navigation/loginWebViewStyles';
import { createFeedStyles } from '@/features/feed/styles';
import { createLibraryStyles } from '@/features/library/styles';
import { createMoreStyles } from '@/features/more/styles';
import { createSearchStyles } from '@/features/search/styles';
import { createTopicStyles } from '@/features/topic/styles';
import { createUserStyles } from '@/features/user/styles';
import { createSharedStyles } from '@/ui/theme/sharedStyles';
import type { ReaderTheme } from '@/ui/theme/tokens';

export function createTestStyles(theme: ReaderTheme, settings: ReaderSettings, windowHeight: number) {
  const sharedStyles = createSharedStyles(theme, settings, windowHeight);
  return Object.assign(
    {},
    createAppStyles(sharedStyles, theme),
    createMoreAccountStyles(sharedStyles, theme, settings),
    createLoginWebViewStyles(sharedStyles, theme, settings),
    createFeedStyles(sharedStyles, theme, settings),
    createLibraryStyles(sharedStyles, theme, settings),
    createMoreStyles(sharedStyles, theme, settings),
    createSearchStyles(sharedStyles, theme, settings),
    createTopicStyles(sharedStyles, theme, settings),
    createUserStyles(sharedStyles, theme, settings)
  );
}
