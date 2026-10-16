import {
  paymentInterbankV1CancelQueryV1,
  paymentInterbankV1CancelRepliedV1,
  paymentInterbankV1ReconciliationQueryV1,
  paymentInterbankV1ReconciliationRepliedV1,
  paymentInterbankV1ResultReceivedV1,
  paymentInterbankV1ReversalQueryV1,
  paymentInterbankV1ReversalRepliedV1,
  paymentInterbankV1ReversalRequestedV1,
  paymentInterbankV1StatusQueryV1,
  paymentInterbankV1StatusRepliedV1,
  paymentInterbankV1TransferQueryV1,
  paymentInterbankV1TransferRepliedV1,
} from '@bank/contracts';
import {
  accountBalanceQueryV1,
  accountBalanceRepliedV1,
  accountBillersQueryV1,
  accountStatsRepliedV1,
  auditStatsRepliedV1,
  customerStatsQueryV1,
  customerStatsRepliedV1,
  paymentStatsRepliedV1,
  transactionStatsRepliedV1,
  accountBillersRepliedV1,
  accountCreateV1,
  accountDepositRejectedV1,
  accountDepositV1,
  accountDepositedV1,
  accountListQueryV1,
  accountListRepliedV1,
  accountOperationsQueryV1,
  accountOperationsRepliedV1,
  accountSetStatusV1,
  alertSloReceivedV1,
  paymentInterbankCallbackReceivedV1,
  paymentInterbankReceiveV1,
  auditQueryRepliedV1,
  auditQueryRequestedV1,
  auditEventsListQueryV1,
  auditEventsListRepliedV1,
  customerAuthenticateRepliedV1,
  customerAuthenticateV1,
  customerEmailVerificationRejectedV1,
  customerEmailVerifiedV1,
  customerGetQueryV1,
  customerGetRepliedV1,
  customerIdentityDocumentQueryV1,
  customerIdentityDocumentRepliedV1,
  customerPendingValidationQueryV1,
  customerPendingValidationRepliedV1,
  customerListQueryV1,
  customerListRepliedV1,
  customerChangePasswordV1,
  customerPasswordChangedV1,
  customerPasswordChangeRejectedV1,
  customerPasswordResetCompletedV1,
  customerPasswordResetConfirmV1,
  customerPasswordResetRejectedV1,
  customerPasswordResetRequestedV1,
  customerRegisterV1,
  customerSetIdentityVerdictV1,
  customerSetKycStatusV1,
  customerUpdateV1,
  customerVerifyEmailV1,
  paymentListQueryV1,
  paymentListRepliedV1,
  paymentSimulationQueryV1,
  paymentSimulationRepliedV1,
  paymentSimulationUpdateV1,
  paymentStatusQueryV1,
  notificationInboxQueryV1,
  notificationInboxRepliedV1,
  notificationListQueryV1,
  notificationMarkReadV1,
  notificationReadRepliedV1,
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
  /*
   * The dashboard is the one route that publishes **five** messages, and the
   * table has room for one. It is listed under the first of them, which is the
   * honest half-truth available here; the other four are its siblings and the
   * use case names all five in one place.
   */
  'GET /api/dashboard': {
    publishes: customerStatsQueryV1.name,
    awaits: [
      customerStatsRepliedV1.name,
      accountStatsRepliedV1.name,
      transactionStatsRepliedV1.name,
      paymentStatsRepliedV1.name,
      auditStatsRepliedV1.name,
    ],
  },
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
  'GET /api/customers': {
    publishes: customerListQueryV1.name,
    awaits: [customerListRepliedV1.name],
  },
  'GET /api/customers/pending-validation': {
    publishes: customerPendingValidationQueryV1.name,
    awaits: [customerPendingValidationRepliedV1.name],
  },
  'POST /api/customers/{customerId}/identity-verdict': {
    publishes: customerSetIdentityVerdictV1.name,
  },
  'POST /api/customers/{customerId}/kyc-status': {
    publishes: customerSetKycStatusV1.name,
  },
  'GET /api/customers/{customerId}/identity-document': {
    publishes: customerIdentityDocumentQueryV1.name,
    awaits: [customerIdentityDocumentRepliedV1.name],
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
  'GET /api/accounts/billers': {
    publishes: accountBillersQueryV1.name,
    awaits: [accountBillersRepliedV1.name],
  },
  'POST /api/accounts/{accountId}/deposit': {
    publishes: accountDepositV1.name,
    // Events, not replies — the same correlation the activation link uses.
    awaits: [accountDepositedV1.name, accountDepositRejectedV1.name],
  },
  'POST /api/accounts/{accountId}/status': { publishes: accountSetStatusV1.name },
  'GET /api/notifications': {
    publishes: notificationInboxQueryV1.name,
    awaits: [notificationInboxRepliedV1.name],
  },
  'POST /api/notifications/read': {
    publishes: notificationMarkReadV1.name,
    awaits: [notificationReadRepliedV1.name],
  },
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
  'GET /api/payments/simulation': {
    publishes: paymentSimulationQueryV1.name,
    awaits: [paymentSimulationRepliedV1.name],
  },
  'PUT /api/payments/simulation': {
    publishes: paymentSimulationUpdateV1.name,
    awaits: [paymentSimulationRepliedV1.name],
  },
  'GET /api/payments/{paymentId}': {
    publishes: paymentStatusQueryV1.name,
    awaits: [paymentStatusRepliedV1.name],
  },
  'GET /api/audit': {
    publishes: auditQueryRequestedV1.name,
    awaits: [auditQueryRepliedV1.name],
  },
  // T-45: the webhook Grafana calls, with no session. It answers `202` and awaits nothing.
  'POST /api/alerts/slo': {
    publishes: alertSloReceivedV1.name,
  },
  'POST /api/interbank/deposits': {
    publishes: paymentInterbankReceiveV1.name,
  },
  /*
   * Las dos de T-47. El envío publica `transfer.requested.v1` —el MISMO mensaje
   * que una transferencia interna, porque es una transferencia interna con el
   * destino en la cuenta de liquidación— y de ahí que no haya un comando propio
   * para enviar depósitos. El callback publica la decisión del banco pareja
   * para que Payment la registre.
   */
  'POST /api/interbank/transfers': {
    publishes: transferRequestedV1.name,
  },
  'POST /api/interbank/callbacks': {
    publishes: paymentInterbankCallbackReceivedV1.name,
  },
  'GET /api/audit/recent': {
    publishes: auditEventsListQueryV1.name,
    awaits: [auditEventsListRepliedV1.name],
  },
  'GET /api/audit/notifications': {
    publishes: notificationListQueryV1.name,
    awaits: [notificationListRepliedV1.name],
  },
  /*
   * Las seis del **contrato interbancario oficial** que publican algo (T-56).
   * `GET /interbank/v1/health` no está porque no publica: se contesta en el
   * borde, y es lo único de este controlador que el Gateway decide solo.
   *
   * Estar aquí es lo que las mete en `publish-routing.integration.spec.ts`, que
   * publica contra un broker **real** y comprueba el exchange y la routing key
   * de cada una. No es un detalle de cobertura: las siete rutas se desplegaron
   * devolviendo `500` porque sus doce contratos no estaban en el catálogo, y el
   * arnés del Gateway dobla el publicador — a un doble el catálogo le da igual.
   * Esta suite es la que lo habría visto.
   */
  'POST /interbank/v1/transfers': {
    publishes: paymentInterbankV1TransferQueryV1.name,
    awaits: [paymentInterbankV1TransferRepliedV1.name],
  },
  'GET /interbank/v1/transfers/{interbankTransferId}': {
    publishes: paymentInterbankV1StatusQueryV1.name,
    awaits: [paymentInterbankV1StatusRepliedV1.name],
  },
  'POST /interbank/v1/transfers/{interbankTransferId}/cancel': {
    publishes: paymentInterbankV1CancelQueryV1.name,
    awaits: [paymentInterbankV1CancelRepliedV1.name],
  },
  'POST /interbank/v1/transfers/{interbankTransferId}/result': {
    publishes: paymentInterbankV1ResultReceivedV1.name,
  },
  'POST /interbank/v1/reversals': {
    publishes: paymentInterbankV1ReversalRequestedV1.name,
    awaits: [paymentInterbankV1ReversalRepliedV1.name],
  },
  'GET /interbank/v1/reversals/{reversalId}': {
    publishes: paymentInterbankV1ReversalQueryV1.name,
    awaits: [paymentInterbankV1ReversalRepliedV1.name],
  },
  'GET /interbank/v1/reconciliation': {
    publishes: paymentInterbankV1ReconciliationQueryV1.name,
    awaits: [paymentInterbankV1ReconciliationRepliedV1.name],
  },
};
