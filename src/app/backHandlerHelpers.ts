import type { Screen } from '../appTypes';

export function shouldCloseReplyComposerOnBack(screen: Screen, replyComposerOpen: boolean) {
  return screen === 'topic' && replyComposerOpen;
}
