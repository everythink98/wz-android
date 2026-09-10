import { describe, expect, it, jest } from '@jest/globals';

describe('startup module evaluation', () => {
  it('keeps non-home pages, sharing, formulas and editor payloads outside the real App entry import chain', () => {
    const modules = [
      '@/features/library/LibraryRoute',
      '@/features/more/MoreRoute',
      '@/features/search/SearchRoute',
      '@/features/topic/TopicRoute',
      '@/features/user/UserRoute',
      '@/features/notifications/NotificationRoute',
      '@/ui/composer/generated/editorDocument.json',
      '@/features/topic/rendering/mathJaxSvg',
      'expo-sharing'
    ];
    const loads = modules.map(() => jest.fn(() => ({})));
    jest.isolateModules(() => {
      modules.forEach((name, index) => jest.doMock(name, loads[index]));
      jest.doMock('expo', () => ({ ...jest.requireActual<object>('expo'), registerRootComponent: jest.fn() }));
      jest.doMock('expo-dev-client', () => ({}));
      require('../../../index');
      loads.forEach((load) => expect(load).not.toHaveBeenCalled());
    });
    modules.forEach((name) => jest.dontMock(name));
  });

  it('does not evaluate the bundled editor document when importing the editor', () => {
    const loadDocument = jest.fn(() => ({ html: '<html>editor</html>' }));
    jest.isolateModules(() => {
      jest.doMock('@/ui/composer/generated/editorDocument.json', loadDocument);
      require('@/ui/composer/StructuredReplyComposer');
      expect(loadDocument).not.toHaveBeenCalled();
    });
  });

  it('does not register MathJax or its fonts when importing the formula component', () => {
    const loadRenderer = jest.fn(() => ({ renderMathJaxSvg: jest.fn() }));
    jest.isolateModules(() => {
      jest.doMock('@/features/topic/rendering/mathJaxSvg', loadRenderer);
      require('@/features/topic/rendering/ForumMath');
      expect(loadRenderer).not.toHaveBeenCalled();
    });
  });
});
