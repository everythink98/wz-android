import type { ReaderSettings } from '@/domain/reader/readerData';
import { createAppStyles } from '@/app/styles';
import { createMoreAccountStyles } from '@/features/more/accountStyles';
import { createLoginWebViewStyles } from '@/ui/navigation/loginWebViewStyles';
import { createFeedStyles } from '@/features/feed/styles';
import { createLibraryStyles } from '@/features/library/styles';
import { createMoreStyles } from '@/features/more/styles';
import { createSearchStyles } from '@/features/search/styles';
import { createTopicStyles } from '@/features/topic/styles';
import { createHtmlRendererStyles } from '@/features/topic/rendering/htmlStyles';
import { createUserStyles } from '@/features/user/styles';
import type { ReaderTheme } from '@/ui/theme/tokens';

export function createTestStyles(theme: ReaderTheme, settings: ReaderSettings, _windowHeight: number) {
  return Object.assign(
    {},
    createAppStyles(theme),
    createMoreAccountStyles(theme, settings),
    createLoginWebViewStyles(theme, settings),
    createFeedStyles(theme, settings),
    createLibraryStyles(theme, settings),
    createMoreStyles(theme, settings),
    createSearchStyles(theme, settings),
    createTopicStyles(theme, settings),
    createHtmlRendererStyles(settings, theme),
    createUserStyles(theme, settings)
  );
}
