type Interaction = 'resting' | 'reset-pending' | 'auto-page-armed';

export function createUserListInteraction() {
  let state: Interaction = 'resting';
  return {
    get needsReset() {
      return state === 'reset-pending';
    },
    requestReset() {
      state = 'reset-pending';
    },
    resetCompleted() {
      if (state === 'reset-pending') state = 'resting';
    },
    dragged() {
      state = 'auto-page-armed';
    },
    disarm() {
      if (state === 'auto-page-armed') state = 'resting';
    },
    consumePage() {
      if (state !== 'auto-page-armed') return false;
      state = 'resting';
      return true;
    }
  };
}
