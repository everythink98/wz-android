import { describe, expect, it } from 'vitest';
import { normalizeNodeSeekStardustStatus } from './stardust';
import { normalizeNodeSeekStardustMarkers } from './stardustMarkup';
import { prepareNodeSeekForumContent } from './topicParser';
import { parseHtml } from '@/domain/forum/html';

describe('NodeSeek composer write protocols', () => {
  it('[REG-WRITE-071] derives status only from the real Stardust records payload', () => {
    expect(
      normalizeNodeSeekStardustStatus({
        listPayload: { success: true, records: [{ diff: 3 }, { diff: -2 }, { diff: '5' }], exist_more: false },
        peerPayload: { success: true, records: [{ diff: 5 }], exist_more: false },
        oneTime: false
      })
    ).toEqual({ participantCount: 3, totalAmount: 8, paid: true, closed: false });
    expect(
      normalizeNodeSeekStardustStatus({
        listPayload: { success: true, records: [{ diff: 0 }], exist_more: false },
        peerPayload: { success: true, records: [], exist_more: false },
        oneTime: true
      })
    ).toEqual({ participantCount: 1, totalAmount: 0, paid: false, closed: true });
    expect(() => normalizeNodeSeekStardustStatus({ listPayload: { success: true, list: [] }, oneTime: false })).toThrow(
      'NodeSeek Stardust 返回内容格式不正确'
    );
    expect(() =>
      normalizeNodeSeekStardustStatus({
        listPayload: { success: false, message: '每天最多进行500次星辰记录查询' },
        oneTime: false
      })
    ).toThrow('每天最多进行500次星辰记录查询');
  });

  it('[REG-WRITE-028] keeps Stardust cards at their text position and leaves code or invalid markers inert', () => {
    const valid = 'nsapp://stardust-receive?member_id=42&ref_id=7&description=Pay&diff=5&onetime=false';
    const invalid = 'nsapp://stardust-receive?member_id=x&ref_id=7&description=Pay&diff=5&onetime=false';
    const root = parseHtml(`<p>前 ${valid} 后</p><pre><code>${valid}</code></pre><p>${invalid}</p>`);
    normalizeNodeSeekStardustMarkers(root);
    const html = root.toString();
    expect(html).toContain(`前 <forum-nodeseek-stardust member-id="42"`);
    expect(html).toContain('</forum-nodeseek-stardust> 后');
    expect(html.match(/<forum-nodeseek-stardust/g)).toHaveLength(1);
    expect(html).toContain(`<code>${valid}</code>`);
    expect(html).toContain(invalid);
  });

  it('[REG-TOPIC-128] recognizes the canonical data-href marker from a real NodeSeek anchor', () => {
    const marker =
      'nsapp://stardust-receive?member_id=37571&ref_id=67181806&description=Pay+with+Stardust&diff=2&onetime=true';
    const visible =
      'nsapp://stardust-receive?member_id=37571&ref_id=67181806&description=Pay with Stardust&diff=2&onetime=true';
    const root = parseHtml(
      `<p>前 <a href="javascript://void(0)" data-href="${marker.replaceAll('&', '&amp;')}">${visible.replaceAll(
        '&',
        '&amp;'
      )}</a> 后 <a href="${marker.replaceAll('&', '&amp;')}">普通链接</a></p>` +
        `<pre><code><a data-href="${marker.replaceAll('&', '&amp;')}">代码</a></code></pre>` +
        '<p><a data-href="nsapp://stardust-receive?member_id=x">非法</a></p>'
    );

    normalizeNodeSeekStardustMarkers(root);

    expect(root.toString()).toContain('前 <forum-nodeseek-stardust member-id="37571"');
    expect(root.toString()).toContain('</forum-nodeseek-stardust> 后');
    expect(root.toString().match(/<forum-nodeseek-stardust/g)).toHaveLength(1);
    expect(root.toString()).toContain('href="nsapp://stardust-receive?');
    expect(root.toString()).toContain('<code><a data-href="nsapp://stardust-receive?');
    expect(root.toString()).toContain('data-href="nsapp://stardust-receive?member_id=x"');
  });

  it('[REG-TOPIC-128] keeps a standalone Stardust card beside a poll', () => {
    const stardust = 'nsapp://stardust-receive?member_id=42&ref_id=7&description=Pay&diff=5&onetime=true';
    const vote = 'nsapp://vote?id=200';
    const prepared = prepareNodeSeekForumContent(
      `<p><a href="/jump/stardust">${stardust}</a></p><p><a href="/jump/vote">${vote}</a></p>`,
      {
        polls: [{ id: '200', options: [{ id: 'a', label: 'A' }] }],
        role: 'reply'
      }
    );

    expect(prepared.contentHtml).toContain('<forum-nodeseek-stardust');
    expect(prepared.contentHtml).toContain('data-one-time="true"');
    expect(prepared.contentPlan.rows.map((row) => row.type)).toEqual(['richText', 'poll']);
  });
});
