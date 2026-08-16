import { TRenderEngine } from '@native-html/transient-render-engine';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { HTML_CUSTOM_ELEMENT_MODELS, HTML_IGNORED_DOM_TAGS } from '@/features/topic/rendering/htmlElementModels';
import { buildHtmlRenderingStyles, HTML_ALLOWED_INLINE_STYLES } from '@/features/topic/rendering/htmlStyles';
import { createTheme } from '@/ui/theme/tokens';

const settings = createEmptyReaderData().settings;
const styles = buildHtmlRenderingStyles({ enableDiscourseCallouts: true, settings, theme: createTheme(settings) });

export const forumSelectionTestEngine = new TRenderEngine({
  cssProcessorConfig: {
    inlinePropertiesBlacklist: styles.htmlIgnoredStyles,
    inlinePropertiesWhitelist: HTML_ALLOWED_INLINE_STYLES
  },
  customizeHTMLModels: (defaultModels) => ({ ...defaultModels, ...HTML_CUSTOM_ELEMENT_MODELS }),
  ignoredDomTags: HTML_IGNORED_DOM_TAGS,
  stylesConfig: {
    baseStyle: styles.htmlBaseStyle,
    classesStyles: styles.htmlClassesStyles,
    enableCSSInlineProcessing: true,
    enableUserAgentStyles: true,
    tagsStyles: styles.htmlTagsStyles
  }
});
