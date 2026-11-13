/**
 * @param {{ adb: (...args: string[]) => string, pkg: string }} device
 * @param {(grantNotifications: () => void) => Promise<void>} run
 */
export async function withProofNotificationPermission({ adb, pkg }, run) {
  const permission = 'android.permission.POST_NOTIFICATIONS';
  const permissionBefore = /android.permission.POST_NOTIFICATIONS: granted=(true|false)/u.exec(
    adb('shell', 'dumpsys', 'package', pkg)
  )?.[1];
  if (!permissionBefore) throw new Error('Cannot establish notification permission baseline');
  /** @type {'grantable' | 'closed'} */
  let grantPolicy = 'grantable';
  /** @type {{ kind: 'none' } | { kind: 'failed', error: unknown }} */
  let businessFailure = { kind: 'none' };
  try {
    adb('shell', 'pm', 'revoke', pkg, permission);
    await run(() => {
      if (grantPolicy !== 'grantable') return;
      grantPolicy = 'closed';
      adb('shell', 'pm', 'grant', pkg, permission);
    });
  } catch (error) {
    businessFailure = { kind: 'failed', error };
    throw error;
  } finally {
    grantPolicy = 'closed';
    /** @type {unknown[]} */
    const errors = [];
    for (const cleanup of [
      () => adb('shell', 'am', 'force-stop', pkg),
      () => adb('shell', 'pm', permissionBefore === 'true' ? 'grant' : 'revoke', pkg, permission)
    ]) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      if (businessFailure.kind === 'failed') errors.unshift(businessFailure.error);
      if (errors.length === 1) throw errors[0];
      throw new AggregateError(errors, 'Proof and permission cleanup failed');
    }
  }
}
