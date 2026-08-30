import {
  accountBalanceQueryV1,
  accountBalanceRepliedV1,
  accountCreateV1,
  accountDepositRejectedV1,
  accountDepositV1,
  accountDepositedV1,
  accountListQueryV1,
  accountListRepliedV1,
  accountOperationsQueryV1,
  accountOperationsRepliedV1,
  accountSetStatusV1,
  auditQueryRepliedV1,
  auditQueryRequestedV1,
  customerAuthenticateRepliedV1,
  customerAuthenticateV1,
  customerEmailVerificationRejectedV1,
  customerEmailVerifiedV1,
  customerGetQueryV1,
  customerGetRepliedV1,
  customerPendingValidationQueryV1,
  customerPendingValidationRepliedV1,
  customerChangePasswordV1,
  customerPasswordChangedV1,
  customerPasswordChangeRejectedV1,
  customerPasswordResetCompletedV1,
  customerPasswordResetConfirmV1,
  customerPasswordResetRejectedV1,
  customerPasswordResetRequestedV1,
  customerRegisterV1,
  customerSetIdentityVerdictV1,
  customerUpdateV1,
  customerVerifyEmailV1,
  paymentListQueryV1,
  paymentListRepliedV1,
  paymentStatusQueryV1,
  notificationListQueryV1,
  notificationListRepliedV1,
  paymentStatusRepliedV1,
  transactionListQueryV1,
  transactionListRepliedV1,
  transactionStatusRepliedV1,
  transactionStatusRequestedV1,
  transferRequestedV1,
} from '@bank/contracts';

export interface RouteMessages {
  /** The catalogue message this route puts on the broker. */
  readonly publishes: string;
  /** What it waits for, when it waits. */
  readonly awaits?: readonly string[];
}

/**
 * Which catalogue message belongs to which route.
 *
 * The names are **imported from the contracts**, never typed as strings. That
 * is the difference between a table that documents the catalogue and one that
 * repeats it: a message renamed in T-05 fails to compile here instead of
 * quietly making the published contract wrong.
 */
export const ROUTE_MESSAGES: Readonly<Record<string, RouteMessages>> = {
  'POST /api/auth/login': {
    publishes: customerAuthenticateV1.name,
    awaits: [customerAuthenticateRepliedV1.name],
  },
  /*
   * Password recovery. The request awaits nothing on purpose: an unknown
   * address produces no event at all, so there is nothing to correlate — which
   * is what keeps the route from answering "does this person bank here".
   */
  'POST /api/auth/password-reset': { publishes: customerPasswordResetRequestedV1.name },
  'POST /api/auth/password-reset/confirm': {
    publishes: customerPasswordResetConfirmV1.name,
    // Events, not replies — the same correlation the activation link uses.
    awaits: [customerPasswordResetCompletedV1.name, customerPasswordResetRejectedV1.name],
  },
  'POST /api/customers': { publishes: customerRegisterV1.name },
  'GET /api/customers/verify-email': {
    publishes: customerVerifyEmailV1.name,
    // Events, not replies — correlated rather than consumed (research R2).
    awaits: [customerEmailVerifiedV1.name, customerEmailVerificationRejectedV1.name],
  },
  'PATCH /api/customers/{customerId}': { publishes: customerUpdateV1.name },
  'POST /api/customers/{customerId}/password': {
    publishes: customerChangePasswordV1.name,
    awaits: [customerPasswordChangedV1.name, customerPasswordChangeRejectedV1.name],
  },
  'GET /api/customers/pending-validation': {
    publishes: customerPendingValidationQueryV1.name,
    awaits: [customerPendingValidationRepliedV1.name],
  },
  'POST /api/customers/{customerId}/identity-verdict': {
    publishes: customerSetIdentityVerdictV1.name,
  },
  'GET /api/customers/{customerId}': {
    publishes: customerGetQueryV1.name,
    awaits: [customerGetRepliedV1.name],
  },
  'POST /api/accounts': { publishes: accountCreateV1.name },
  'GET /api/accounts/{accountId}/balance': {
    publishes: accountBalanceQueryV1.name,
    awaits: [accountBalanceRepliedV1.name],
  },
  'GET /api/accounts': {
    publishes: accountListQueryV1.name,
    awaits: [accountListRepliedV1.name],
  },
  'GET /api/accounts/{accountId}/operations': {
    publishes: accountOperationsQueryV1.name,
    awaits: [accountOperationsRepliedV1.name],
  },
  'POST /api/accounts/{accountId}/deposit': {
    publishes: accountDepositV1.name,
    // Events, not replies — the same correlation the activation link uses.
    awaits: [accountDepositedV1.name, accountDepositRejectedV1.name],
  },
  'POST /api/accounts/{accountId}/status': { publishes: accountSetStatusV1.name },
  'GET /api/transfers': {
    publishes: transactionListQueryV1.name,
    awaits: [transactionListRepliedV1.name],
  },
  'POST /api/transfers': { publishes: transferRequestedV1.name },
  'GET /api/transfers/{transactionId}': {
    publishes: transactionStatusRequestedV1.name,
    awaits: [transactionStatusRepliedV1.name],
  },
  'GET /api/payments': {
    publishes: paymentListQueryV1.name,
    awaits: [paymentListRepliedV1.name],
  },
  'GET /api/payments/{paymentId}': {
    publishes: paymentStatusQueryV1.name,
    awaits: [paymentStatusRepliedV1.name],
  },
  'GET /api/audit': {
    publishes: auditQueryRequestedV1.name,
    awaits: [auditQueryRepliedV1.name],
  },
  'GET /api/audit/notifications': {
    publishes: notificationListQueryV1.name,
    awaits: [notificationListRepliedV1.name],
  },
};
