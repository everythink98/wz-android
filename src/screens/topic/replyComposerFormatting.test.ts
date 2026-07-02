import { describe, expect, it } from 'vitest';
import {
  applyReplyComposerFormat,
  replyComposerToolbarItems,
  replaceReplyComposerSelection
} from './replyComposerFormatting';

describe('reply composer formatting', () => {
  it('inserts Markdown formatting for NodeSeek and linux.do replies', () => {
    expect(applyReplyComposerFormat({
      action: 'bold',
      content: 'hello',
      selection: { start: 0, end: 5 },
      source: 'linuxdo'
    })).toBe('**hello**');

    expect(applyReplyComposerFormat({
      action: 'image',
      content: '',
      selection: { start: 0, end: 0 },
      source: 'nodeseek'
    })).toBe('![图片描述](https://)');

    expect(applyReplyComposerFormat({
      action: 'heading',
      content: '小标题',
      selection: { start: 0, end: 3 },
      source: 'linuxdo'
    })).toBe('## 小标题');
  });

  it('inserts UBB formatting for yaohuo replies', () => {
    expect(applyReplyComposerFormat({
      action: 'quote',
      content: '引用',
      selection: { start: 0, end: 2 },
      source: 'yaohuo'
    })).toBe('[quote]引用[/quote]');
  });

  it('shows heading only for Markdown reply sources', () => {
    expect(replyComposerToolbarItems('linuxdo').map((item) => item.type === 'format' ? item.action : item.accessory)).toContain('heading');
    expect(replyComposerToolbarItems('nodeseek').map((item) => item.type === 'format' ? item.action : item.accessory)).toContain('heading');
    expect(replyComposerToolbarItems('yaohuo').map((item) => item.type === 'format' ? item.action : item.accessory)).not.toContain('heading');
  });

  it('puts the per-site expression entry in the scrollable toolbar', () => {
    expect(replyComposerToolbarItems('nodeseek').map((item) => item.type === 'accessory' ? item.accessory : item.action)).toContain('nodeseek-sticker');
    expect(replyComposerToolbarItems('linuxdo').map((item) => item.type === 'accessory' ? item.accessory : item.action)).toContain('linuxdo-emoji');
    expect(replyComposerToolbarItems('yaohuo').map((item) => item.type === 'accessory' ? item.accessory : item.action)).toContain('yaohuo-face');
    expect(replyComposerToolbarItems('v2ex')).toEqual([]);
  });

  it('inserts NodeSeek and linux.do expression codes into reply text', () => {
    expect(replaceReplyComposerSelection('hello', { start: 5, end: 5 }, ':ac01:')).toBe('hello:ac01:');

    expect(replaceReplyComposerSelection('hi there', { start: 3, end: 8 }, ':grinning_face:')).toBe('hi :grinning_face:');
  });
});
