import type { Harness } from './harness';

/**
 * What Account Service answers when the Gateway asks whether a `CLIENTE` can
 * see the source account of a transfer (T-60).
 *
 * The Gateway holds no accounts, so a spec that posts a transfer as a
 * `CLIENTE` has to script the owning service's side of that question. These two
 * are the only two answers Account gives: the account is theirs, or the
 * account — theirs or not — is not there for them.
 */
export function accountIsVisible(harness: Harness, accountId: string): void {
  harness.replier.answerWith('account.balance.replied.v1', {
    outcome: 'FOUND',
    accountId,
    balance: { amountMinor: 10_000_000, currency: 'GTQ' },
    status: 'ACTIVE',
    lastActivityAt: null,
  });
}

export function accountIsNotVisible(harness: Harness): void {
  harness.replier.answerWith('account.balance.replied.v1', {
    outcome: 'NOT_FOUND',
    reason: 'ACCOUNT_NOT_FOUND',
  });
}
