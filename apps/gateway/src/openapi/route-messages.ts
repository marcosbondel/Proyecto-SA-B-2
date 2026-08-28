import {
  accountBalanceQueryV1,
  accountBalanceRepliedV1,
  accountCreateV1,
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
  'POST /api/customers': { publishes: customerRegisterV1.name },
  'GET /api/customers/verify-email': {
    publishes: customerVerifyEmailV1.name,
    // Events, not replies — correlated rather than consumed (research R2).
    awaits: [customerEmailVerifiedV1.name, customerEmailVerificationRejectedV1.name],
  },
  'PATCH /api/customers/{customerId}': { publishes: customerUpdateV1.name },
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
  'POST /api/accounts/{accountId}/status': { publishes: accountSetStatusV1.name },
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
