import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => effect(),
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => {
    let state = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [state, (next: T | ((current: T) => T)) => {
      state = typeof next === 'function' ? (next as (current: T) => T)(state) : next;
    }];
  }
}));

vi.mock('react-native', () => ({
  Keyboard: { dismiss: vi.fn() },
  useWindowDimensions: () => ({ height: 2400 })
}));

vi.mock('@gorhom/bottom-sheet', () => ({
  default: 'BottomSheet',
  BottomSheetBackdrop: 'BottomSheetBackdrop',
  BottomSheetView: 'BottomSheetView'
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 })
}));

vi.mock('./ReplyComposer', () => ({
  ReplyComposer: 'ReplyComposer'
}));

Object.assign(globalThis, {
  React: {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
      type,
      props: {
        ...(props || {}),
        children: children.length > 1 ? children : children[0]
      }
    })
  }
});

const { ReplyComposerSheet } = await import('./ReplyComposerSheet');

type TestElement = {
  props?: Record<string, unknown> & { children?: unknown };
  type?: unknown;
};

function findElement(node: unknown, type: string): TestElement {
  if (!node || typeof node !== 'object') {
    throw new Error(`Missing ${type} test element.`);
  }
  const element = node as TestElement;
  if (element.type === type) {
    return element;
  }
  const children = Array.isArray(element.props?.children)
    ? element.props.children
    : [element.props?.children];
  for (const child of children) {
    try {
      return findElement(child, type);
    } catch {
      // Keep walking sibling elements.
    }
  }
  throw new Error(`Missing ${type} test element.`);
}

function renderComposer(overrides: Partial<Parameters<typeof ReplyComposerSheet>[0]> = {}) {
  const onReplyComposerOpenChange = vi.fn();
  const onReplyContentChange = vi.fn();
  const onSubmitReply = vi.fn();
  const tree = ReplyComposerSheet({
    actionBusy: false,
    replyContent: 'initial',
    replyFace: '',
    replyTarget: null,
    source: 'nodeseek',
    styles: {
      replyComposerBottomSheetBackground: {},
      replyComposerBottomSheetContainer: {},
      replyComposerBottomSheetContent: {}
    } as never,
    theme: { dark: false } as never,
    visible: true,
    onReplyComposerOpenChange,
    onReplyContentChange,
    onReplyFaceChange: vi.fn(),
    onSubmitReply,
    ...overrides
  });
  return {
    bottomSheet: findElement(tree, 'BottomSheet').props!,
    composer: findElement(tree, 'ReplyComposer').props!,
    onReplyComposerOpenChange,
    onReplyContentChange,
    onSubmitReply
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('reply composer local draft behavior', () => {
  it('keeps keystrokes local until blur or sheet close commits the current draft', () => {
    const rendered = renderComposer();

    (rendered.composer.onReplyContentChange as (content: string) => void)('typed locally');
    expect(rendered.onReplyContentChange).not.toHaveBeenCalled();

    (rendered.composer.onReplyContentCommit as () => string)();
    expect(rendered.onReplyContentChange).toHaveBeenLastCalledWith('typed locally');

    (rendered.composer.onReplyContentChange as (content: string) => void)('closed draft');
    (rendered.bottomSheet.onClose as () => void)();
    expect(rendered.onReplyContentChange).toHaveBeenLastCalledWith('closed draft');
    expect(rendered.onReplyComposerOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('appends an async image result to the latest local draft', async () => {
    const upload = Promise.withResolvers<string>();
    const rendered = renderComposer({ onUploadReplyImage: () => upload.promise });

    const pending = (rendered.composer.onUploadReplyImage as () => Promise<void>)();
    (rendered.composer.onReplyContentChange as (content: string) => void)('typed while uploading');
    upload.resolve('![image](upload://image.png)');
    await pending;

    expect(rendered.onReplyContentChange).toHaveBeenLastCalledWith(
      'typed while uploading\n![image](upload://image.png)'
    );
  });

  it('submits the explicit composer value instead of a stale external draft', () => {
    const rendered = renderComposer();

    (rendered.composer.onSubmitReply as (content: string) => void)('explicit submit value');

    expect(rendered.onReplyContentChange).toHaveBeenLastCalledWith('explicit submit value');
    expect(rendered.onSubmitReply).toHaveBeenCalledWith('explicit submit value');
  });
});
