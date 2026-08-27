import { describe, expect, it } from 'vitest';
import { parseLinuxDoPoll, serializeLinuxDoPoll } from './linuxDoPoll';

describe('LinuxDo poll codec', () => {
  it('covers official builder fields and preserves unknown attributes when edited', () => {
    const raw =
      '[poll name=poll2 type=multiple results=on_close min=1 max=2 public=true chartType=pie dynamic=true groups=staff,trust_level_3 close=2026-09-01T08:00:00.000Z future="keep me"]\n# 标题\n* A\n* B\n[/poll]';
    const poll = parseLinuxDoPoll(raw)!;
    expect(poll).toMatchObject({
      name: 'poll2',
      type: 'multiple',
      results: 'on_close',
      min: 1,
      max: 2,
      publicPoll: true,
      chartType: 'pie',
      dynamic: true,
      groups: ['staff', 'trust_level_3'],
      title: '标题',
      options: ['A', 'B'],
      unknownAttributes: ['future="keep me"']
    });
    const edited = serializeLinuxDoPoll({ ...poll, title: '新标题' });
    expect(edited).toContain('groups=staff,trust_level_3');
    expect(edited).toContain('future="keep me"');
  });

  it('serializes number and ranked-choice polls without inventing options', () => {
    const number = parseLinuxDoPoll('[poll type=number results=always min=1 max=10 step=2 public=false]\n[/poll]')!;
    expect(serializeLinuxDoPoll(number)).toContain('type=number results=always min=1 max=10 step=2 public=false');
    const ranked = parseLinuxDoPoll(
      '[poll type=ranked_choice results=on_vote public=true chartType=bar]\n* A\n* B\n[/poll]'
    )!;
    const rankedMarkdown = serializeLinuxDoPoll(ranked);
    expect(rankedMarkdown).toContain('type=ranked_choice');
    expect(rankedMarkdown).not.toContain('chartType=');
  });
});
