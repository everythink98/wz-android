import { describe, expect, it } from 'vitest';
import { linuxDoInteractionConfig, linuxDoSiteSettingsFromHtml } from './interactionConfig';

describe('LinuxDo interaction settings', () => {
  it('uses the enabled reaction list and default reaction instead of the whole emoji directory', () => {
    const settings = {
      discourse_reactions_enabled: true,
      discourse_reactions_reaction_for_like: '+1',
      discourse_reactions_enabled_reactions: 'heart|bili_057|bili_057|bad/id',
      discourse_boosts_enabled: true,
      discourse_boosts_max_per_post: 80
    };
    const html = `<script id="data-preloaded" type="application/json">${JSON.stringify({ siteSettings: JSON.stringify(settings) })}</script>`;
    expect(linuxDoInteractionConfig(linuxDoSiteSettingsFromHtml(html))).toEqual({
      reactionsEnabled: true,
      enabledReactions: ['+1', 'heart', 'bili_057'],
      reactionForLike: '+1',
      boostsEnabled: true,
      maxBoostsPerPost: 80
    });
    expect(linuxDoInteractionConfig({})).toMatchObject({
      reactionsEnabled: false,
      boostsEnabled: false,
      enabledReactions: []
    });
    expect(() => linuxDoInteractionConfig({ discourse_reactions_reaction_for_like: '../../x' })).toThrow();
  });
});
