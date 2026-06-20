import { describe, expect, it } from 'vitest';
import { pollParticipationLabel } from '../../topicPollDisplay';

describe('TopicPolls', () => {
  it('uses participant count before summed option votes', () => {
    expect(pollParticipationLabel({
      participantCount: 2,
      multiple: true,
      options: [
        { id: 'a', label: 'A', count: 4 },
        { id: 'b', label: 'B', count: 3 }
      ]
    })).toBe('2 人参与');
  });

  it('falls back to summed votes when participant count is missing', () => {
    expect(pollParticipationLabel({
      options: [
        { id: 'a', label: 'A', count: 4 },
        { id: 'b', label: 'B', count: 3 }
      ]
    })).toBe('7 票');
  });
});
