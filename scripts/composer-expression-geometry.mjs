// Read-only geometry oracle shared by the Android composer proof and live inspection.
export function captureComposerExpressionGeometry(document) {
  const window = document.defaultView;
  const panel = document.querySelector('[data-expression-cache]:not([hidden])');
  if (!panel) throw new Error('Expression picker is not visible');
  const runtime = document.querySelector('.runtime');
  const header = panel.querySelector('.builder-header');
  const navigation = panel.querySelector('.category-rail, .expression-search');
  const body = panel.querySelector('.builder-body');
  const close = header.querySelector('[aria-label="关闭"]');
  const editor = document.querySelector('.editor-pane.active, .source-pane.active');
  const buttons = [...panel.querySelectorAll('.expression-grid:not([hidden]) button')];
  const rect = (element) => {
    const { x, y, width, height, top, bottom, left, right } = element.getBoundingClientRect();
    return { x, y, width, height, top, bottom, left, right };
  };
  const frame = rect(body);
  const first = buttons[0];
  const style = window.getComputedStyle(body);
  const itemHeight = first ? rect(first).height : 60;
  const gap = first ? parseFloat(window.getComputedStyle(first.parentElement).rowGap) : 4;
  const usableHeight = frame.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  let leakedGrid = false;
  for (let y = rect(header).top + 2; y < frame.top; y += 4) {
    for (let x = frame.left + 8; x < frame.right; x += 24) {
      if (document.elementFromPoint(x, y)?.closest('.expression-grid')) leakedGrid = true;
    }
  }
  return {
    runtime: rect(runtime),
    header: rect(header),
    navigation: rect(navigation),
    body: frame,
    close: rect(close),
    scrollTop: body.scrollTop,
    scrollHeight: body.scrollHeight,
    rowCapacity: Math.floor((usableHeight + gap) / (itemHeight + gap)),
    itemHeight,
    navigationInScroller: body.contains(navigation),
    leakedGrid,
    missingLoadingFeedback: buttons.some((button) => {
      const image = button.querySelector('img');
      if (!image || image.complete) return false;
      const imageStyle = window.getComputedStyle(image);
      return button.getAttribute('aria-busy') !== 'true' || !(parseFloat(imageStyle.borderTopWidth) > 0);
    }),
    editorHidden: window.getComputedStyle(editor).visibility === 'hidden',
    editor: rect(editor),
    editorAccessible: editor.getAttribute('aria-hidden') !== 'true',
    loadedImages: [...panel.querySelectorAll('.expression-grid:not([hidden]) img')].filter(
      (element) => element.complete && element.naturalWidth > 0
    ).length,
    fullyVisibleButtons: buttons.filter((element) => {
      const item = rect(element);
      return item.top >= frame.top && item.bottom <= frame.bottom;
    }).length
  };
}

export function assertComposerExpressionGeometry(value, previous) {
  if (value.missingLoadingFeedback !== false)
    throw new Error('Pending expression images have no visible loading feedback');
  if (value.navigationInScroller || value.leakedGrid) throw new Error('Images overlap the fixed expression navigation');
  const preview = value.runtime.height >= 560;
  if (!preview && !value.editorHidden) throw new Error('Expression picker shares its space with the body editor');
  if (
    preview &&
    (value.editorHidden || !value.editorAccessible || Math.abs(value.editor.bottom - value.header.top) > 1)
  )
    throw new Error('Tall composer does not retain a separate accessible draft preview');
  if (
    Math.abs(value.header.top - (preview ? value.runtime.bottom - 360 : value.runtime.top)) > 1 ||
    Math.abs(value.body.top - value.header.bottom) > 1 ||
    Math.abs(value.body.bottom - value.runtime.bottom) > 1
  )
    throw new Error('Expression picker does not fill the composer viewport');
  if (value.close.height < 48 || value.close.width < 48 || value.itemHeight < 48)
    throw new Error('Expression controls do not retain accessible touch targets');
  const minimumRows = value.runtime.height >= 250 ? 3 : 1;
  if (value.rowCapacity < minimumRows)
    throw new Error(`Expression viewport cannot display ${minimumRows} complete rows`);
  if (previous && Math.abs(value.navigation.top - previous.navigation.top) > 1)
    throw new Error('Expression navigation moves when images scroll');
  return value;
}

export function assertComposerExpressionInsets(nodes, windowInsets, keyboardShown) {
  const ime = windowInsets.match(/type=ime[^\r\n]*?\bframe=\[0,(\d+)\]\[\d+,\d+\][^\r\n]*?\bvisible=(true|false)/);
  const navigation = windowInsets.match(/type=navigationBars[^\r\n]*?\bframe=\[0,(\d+)\]\[\d+,\d+\]/);
  const frame = nodes.find((node) => node.identifier === 'structured-composer-editor-frame')?.rect;
  if (!ime || !navigation || !frame) throw new Error('Expression native viewport geometry unavailable');
  if ((ime[2] === 'true') !== keyboardShown) throw new Error('Expression IME has not settled');
  const bottom = keyboardShown ? Number(ime[1]) : Number(navigation[1]);
  if (frame.y + frame.height > bottom + 3)
    throw new Error('Keyboard or system navigation covers the expression picker');
  return { frame, bottom, keyboardShown };
}
