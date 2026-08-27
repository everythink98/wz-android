import { describe, expect, it, vi } from 'vitest';
import {
  fingerprintNodeSeekPoll,
  generateNodeSeekStardustRefId,
  nodeSeekPendingPollToken,
  nodeSeekPendingPollTokenRanges,
  nodeSeekRemotePollMarkerRanges,
  nodeSeekStardustMarkerRanges,
  normalizePendingNodeSeekPoll,
  parseNodeSeekStardustReceive,
  replacePendingNodeSeekPollToken,
  serializeNodeSeekStardustReceive
} from './structuredComposer';

describe('structured composer protocol values', () => {
  it('keeps a pending NodeSeek poll local until its remote id is assigned', () => {
    const poll = normalizePendingNodeSeekPoll({
      localId: 'poll_local_1',
      title: '  选一个  ',
      multiple: false,
      isPublic: true,
      options: [' A ', 'B']
    });
    const token = nodeSeekPendingPollToken(poll.localId);
    const markdown = `前文\n\n${token}\n\n后文`;
    expect(nodeSeekPendingPollTokenRanges(markdown)).toEqual([
      { from: 4, to: 4 + token.length, localId: 'poll_local_1' }
    ]);
    expect(poll).toMatchObject({ title: '选一个', options: ['A', 'B'] });
    expect(poll.fingerprint).toBe(fingerprintNodeSeekPoll(poll));
    expect(replacePendingNodeSeekPollToken(markdown, poll.localId, '3023')).toContain('nsapp://vote?id=3023');
    expect(nodeSeekRemotePollMarkerRanges('前 nsapp://vote?id=3023 后 nsapp://vote?id=x')).toEqual([
      { from: 2, to: 22, pollId: '3023' }
    ]);
  });

  it('parses strict Stardust markers and serializes modified cards in official order', () => {
    const original =
      'nsapp://stardust-receive?unknown=keep&member_id=42&ref_id=1&description=Pay%20with%20Stardust&diff=5&onetime=true';
    expect(parseNodeSeekStardustReceive(original)).toEqual({
      receiverMemberId: '42',
      amount: 5,
      refId: 1,
      description: 'Pay with Stardust',
      oneTime: true,
      rawMarker: original
    });
    expect(
      serializeNodeSeekStardustReceive({
        receiverMemberId: '42',
        amount: 5,
        refId: 100,
        description: '测试 & pay',
        oneTime: false
      })
    ).toBe(
      'nsapp://stardust-receive?member_id=42&ref_id=100&description=%E6%B5%8B%E8%AF%95+%26+pay&diff=5&onetime=false'
    );
    expect(() =>
      serializeNodeSeekStardustReceive({
        receiverMemberId: '42',
        amount: 5,
        refId: 99,
        description: '旧卡片',
        oneTime: false
      })
    ).toThrow('Ref ID 必须为大于等于 100 的安全整数');
    expect(
      parseNodeSeekStardustReceive('nsapp://stardust-receive?member_id=42&ref_id=0&diff=5&onetime=true')
    ).toBeNull();
  });

  it('[REG-WRITE-071] generates new Ref IDs with the original NodeSeek formula', () => {
    const random = vi.spyOn(Math, 'random');
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(0.99999999);

    expect([generateNodeSeekStardustRefId(), generateNodeSeekStardustRefId(), generateNodeSeekStardustRefId()]).toEqual(
      [100, 50_000_100, 100_000_099]
    );
    random.mockRestore();
  });

  it('finds valid and invalid Stardust markers without consuming surrounding prose', () => {
    const valid = 'nsapp://stardust-receive?member_id=42&ref_id=7&description=Pay&diff=5&onetime=false';
    const invalid = 'nsapp://stardust-receive?member_id=x&ref_id=7&description=Pay&diff=5&onetime=false';
    const ranges = nodeSeekStardustMarkerRanges(`前 ${valid} 后\n${invalid}`);
    expect(ranges.map((range) => range.rawMarker)).toEqual([valid, invalid]);
    expect(ranges.map((range) => Boolean(range.receive))).toEqual([true, false]);
  });
});
