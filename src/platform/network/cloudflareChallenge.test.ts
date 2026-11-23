import { expect, it } from 'vitest';
import { isCloudflareChallengeResponse } from './cloudflareChallenge';

it('keeps article text between two ordinary scripts out of challenge recognition', () => {
  const response = { status: 200, headers: new Headers({ 'Content-Type': 'text/html' }) };
  expect(
    isCloudflareChallengeResponse({
      ...response,
      bodyText: '<script>start()</script><p>Documentation mentioning cf_chl_ values</p><script>end()</script>'
    })
  ).toBe(false);
  expect(isCloudflareChallengeResponse({ ...response, bodyText: '<script>window._cf_chl_opt = {}</script>' })).toBe(
    true
  );
});
