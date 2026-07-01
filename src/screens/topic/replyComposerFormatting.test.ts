import { describe, expect, it } from 'vitest';
import { applyReplyComposerFormat, replyComposerFormatActions } from './replyComposerFormatting';

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
    expect(replyComposerFormatActions('linuxdo').map((item) => item.action)).toContain('heading');
    expect(replyComposerFormatActions('nodeseek').map((item) => item.action)).toContain('heading');
    expect(replyComposerFormatActions('yaohuo').map((item) => item.action)).not.toContain('heading');
  });
});
