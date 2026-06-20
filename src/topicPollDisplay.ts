import type { TopicPoll } from './types';

export function pollTotalVotes(poll: TopicPoll) {
  return poll.options.reduce((total, option) => total + (typeof option.count === 'number' ? option.count : 0), 0);
}

export function pollParticipationLabel(poll: TopicPoll) {
  if (typeof poll.participantCount === 'number') {
    return `${poll.participantCount} 人参与`;
  }
  const hasCounts = poll.options.some((option) => typeof option.count === 'number');
  return hasCounts ? `${pollTotalVotes(poll)} 票` : undefined;
}
