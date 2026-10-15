import { describe, expect, it } from 'vitest';
import { linuxDoBoostFields, linuxDoBoostFromData } from './boosts';

const boost = {
  id: 51,
  can_delete: true,
  user: { id: 7, username: 'alice', avatar_template: '/user_avatar/linux.do/alice/{size}/1.png' },
  cooked: '<p>前排 &amp; 合影 <img class="emoji emoji-custom" alt=":bili_057:" src="//cdn.ldstatic.com/emoji.png"></p>'
};

describe('LinuxDo boost data', () => {
  it('preserves authors, text and custom emoji without rendering arbitrary HTML', () => {
    expect(linuxDoBoostFromData(boost)).toMatchObject({
      id: 51,
      canDelete: true,
      user: { id: '7', username: 'alice', source: 'linuxdo' },
      content: [{ text: '前排 & 合影 ' }, { emoji: ':bili_057:', imageUrl: 'https://cdn.ldstatic.com/emoji.png' }]
    });
    expect(
      linuxDoBoostFromData({
        ...boost,
        cooked: '<p>保留<script>discard</script><img class="emoji" alt=":bad:" src="javascript:alert(1)"></p>'
      })?.content
    ).toEqual([{ text: '保留' }, { text: ':bad:' }]);
  });
  it('keeps unknown and empty collections distinct and rejects ambiguous identities', () => {
    expect(linuxDoBoostFields({})).toEqual({});
    expect(linuxDoBoostFields({ boosts: [], can_boost: false })).toEqual({ boosts: [], canBoost: false });
    expect(
      linuxDoBoostFields({ boosts: [boost, boost, { id: 0 }, { ...boost, id: 52, user: {} }], can_boost: true }).boosts
    ).toHaveLength(1);
  });
});
