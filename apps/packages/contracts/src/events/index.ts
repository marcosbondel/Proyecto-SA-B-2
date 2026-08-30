import type { MessageContract } from './contract';

import { customerActivationRequestedV1 } from './customer/customer.activation.requested.v1';
import { customerAuthenticateRepliedV1 } from './customer/customer.authenticate.replied.v1';
import { customerAuthenticateV1 } from './customer/customer.authenticate.v1';
import { customerChangePasswordV1 } from './customer/customer.change-password.v1';
import { customerPasswordChangedV1 } from './customer/customer.password-changed.v1';
import { customerPasswordChangeRejectedV1 } from './customer/customer.password-change.rejected.v1';
import { customerEmailVerificationRejectedV1 } from './customer/customer.email.verification.rejected.v1';
import { customerEmailVerifiedV1 } from './customer/customer.email.verified.v1';
import { customerGetQueryV1 } from './customer/customer.get.query.v1';
import { customerGetRepliedV1 } from './customer/customer.get.replied.v1';
import { customerPasswordResetCompletedV1 } from './customer/customer.password-reset.completed.v1';
import { customerPasswordResetConfirmV1 } from './customer/customer.password-reset.confirm.v1';
import { customerPasswordResetIssuedV1 } from './customer/customer.password-reset.issued.v1';
import { customerPasswordResetRejectedV1 } from './customer/customer.password-reset.rejected.v1';
import { customerPasswordResetRequestedV1 } from './customer/customer.password-reset.requested.v1';
import { customerNamesQueryV1 } from './customer/customer.names.query.v1';
import { customerNamesRepliedV1 } from './customer/customer.names.replied.v1';
import { customerPendingValidationQueryV1 } from './customer/customer.pending-validation.query.v1';
import { customerPendingValidationRepliedV1 } from './customer/customer.pending-validation.replied.v1';
import { customerSetIdentityVerdictV1 } from './customer/customer.set-identity-verdict.v1';
import { customerIdentityRejectedV1 } from './customer/customer.identity.rejected.v1';
import { customerIdentityValidatedV1 } from './customer/customer.identity.validated.v1';
import { customerLoginRejectedV1 } from './customer/customer.login.rejected.v1';
import { customerLoginSucceededV1 } from './customer/customer.login.succeeded.v1';
import { customerRegisterRejectedV1 } from './customer/customer.register.rejected.v1';
import { customerRegisterV1 } from './customer/customer.register.v1';
import { customerRegisteredV1 } from './customer/customer.registered.v1';
import { customerUpdateV1 } from './customer/customer.update.v1';
import { customerUpdatedV1 } from './customer/customer.updated.v1';
import { customerValidateIdentityV1 } from './customer/customer.validate-identity.v1';
import { customerVerifyEmailV1 } from './customer/customer.verify-email.v1';
import { accountBalanceQueryV1 } from './account/account.balance.query.v1';
import { accountBalanceRepliedV1 } from './account/account.balance.replied.v1';
import { accountCreateV1 } from './account/account.create.v1';
import { accountCreditRejectedV1 } from './account/account.credit.rejected.v1';
import { accountCreditRequestedV1 } from './account/account.credit.requested.v1';
import { accountBillersQueryV1 } from './account/account.billers.query.v1';
import { accountBillersRepliedV1 } from './account/account.billers.replied.v1';
import { accountDepositV1 } from './account/account.deposit.v1';
import { accountDepositedV1 } from './account/account.deposited.v1';
import { accountDepositRejectedV1 } from './account/account.deposit.rejected.v1';
import { accountCreditedV1 } from './account/account.credited.v1';
import { accountDeactivatedV1 } from './account/account.deactivated.v1';
import { accountDebitCompensatedV1 } from './account/account.debit.compensated.v1';
import { accountDebitCompensationRequestedV1 } from './account/account.debit.compensation.requested.v1';
import { accountDebitRejectedV1 } from './account/account.debit.rejected.v1';
import { accountDebitRequestedV1 } from './account/account.debit.requested.v1';
import { accountDebitedV1 } from './account/account.debited.v1';
import { accountListQueryV1 } from './account/account.list.query.v1';
import { accountListRepliedV1 } from './account/account.list.replied.v1';
import { accountOpenRejectedV1 } from './account/account.open.rejected.v1';
import { accountOpenedV1 } from './account/account.opened.v1';
import { accountOperationsQueryV1 } from './account/account.operations.query.v1';
import { accountOperationsRepliedV1 } from './account/account.operations.replied.v1';
import { accountReactivatedV1 } from './account/account.reactivated.v1';
import { accountSetStatusV1 } from './account/account.set-status.v1';
import { transactionCompensatedV1 } from './transaction/transaction.compensated.v1';
import { transactionCompletedV1 } from './transaction/transaction.completed.v1';
import { transactionFailedV1 } from './transaction/transaction.failed.v1';
import { transactionInitiatedV1 } from './transaction/transaction.initiated.v1';
import { transactionListQueryV1 } from './transaction/transaction.list.query.v1';
import { transactionListRepliedV1 } from './transaction/transaction.list.replied.v1';
import { transactionStatusRepliedV1 } from './transaction/transaction.status.replied.v1';
import { transactionStatusRequestedV1 } from './transaction/transaction.status.requested.v1';
import { transferRequestedV1 } from './transaction/transfer.requested.v1';
import { paymentAttemptFailedV1 } from './payment/payment.attempt.failed.v1';
import { paymentFailedV1 } from './payment/payment.failed.v1';
import { paymentListQueryV1 } from './payment/payment.list.query.v1';
import { paymentListRepliedV1 } from './payment/payment.list.replied.v1';
import { paymentRequestedV1 } from './payment/payment.requested.v1';
import { paymentStatusQueryV1 } from './payment/payment.status.query.v1';
import { paymentStatusRepliedV1 } from './payment/payment.status.replied.v1';
import { paymentSucceededV1 } from './payment/payment.succeeded.v1';
import { notificationListQueryV1 } from './notification/notification.list.query.v1';
import { notificationListRepliedV1 } from './notification/notification.list.replied.v1';
import { auditQueryRepliedV1 } from './audit/audit.query.replied.v1';
import { auditQueryRequestedV1 } from './audit/audit.query.requested.v1';

export type { Category, MessageContract } from './contract';
export { defineContract } from './contract';

export * from './customer/customer.activation.requested.v1';
export * from './customer/customer.authenticate.replied.v1';
export * from './customer/customer.authenticate.v1';
export * from './customer/customer.change-password.v1';
export * from './customer/customer.password-change.rejected.v1';
export * from './customer/customer.password-changed.v1';
export * from './customer/customer.email.verification.rejected.v1';
export * from './customer/customer.email.verified.v1';
export * from './customer/customer.get.query.v1';
export * from './customer/customer.get.replied.v1';
export * from './customer/customer.password-reset.completed.v1';
export * from './customer/customer.password-reset.confirm.v1';
export * from './customer/customer.password-reset.issued.v1';
export * from './customer/customer.password-reset.rejected.v1';
export * from './customer/customer.password-reset.requested.v1';
export * from './customer/customer.names.query.v1';
export * from './customer/customer.names.replied.v1';
export * from './customer/customer.pending-validation.query.v1';
export * from './customer/customer.pending-validation.replied.v1';
export * from './customer/customer.set-identity-verdict.v1';
export * from './customer/customer.identity.rejected.v1';
export * from './customer/customer.identity.validated.v1';
export * from './customer/customer.login.rejected.v1';
export * from './customer/customer.login.succeeded.v1';
export * from './customer/customer.register.rejected.v1';
export * from './customer/customer.register.v1';
export * from './customer/customer.registered.v1';
export * from './customer/customer.update.v1';
export * from './customer/customer.updated.v1';
export * from './customer/customer.validate-identity.v1';
export * from './customer/customer.verify-email.v1';
export * from './account/account.balance.query.v1';
export * from './account/account.balance.replied.v1';
export * from './account/account.create.v1';
export * from './account/account.credit.rejected.v1';
export * from './account/account.credit.requested.v1';
export * from './account/account.billers.query.v1';
export * from './account/account.billers.replied.v1';
export * from './account/account.credited.v1';
export * from './account/account.deposit.rejected.v1';
export * from './account/account.deposit.v1';
export * from './account/account.deposited.v1';
export * from './account/account.deactivated.v1';
export * from './account/account.debit.compensated.v1';
export * from './account/account.debit.compensation.requested.v1';
export * from './account/account.debit.rejected.v1';
export * from './account/account.debit.requested.v1';
export * from './account/account.debited.v1';
export * from './account/account.list.query.v1';
export * from './account/account.list.replied.v1';
export * from './account/account.open.rejected.v1';
export * from './account/account.opened.v1';
export * from './account/account.operations.query.v1';
export * from './account/account.operations.replied.v1';
export * from './account/account.reactivated.v1';
export * from './account/account.set-status.v1';
export * from './transaction/transaction.compensated.v1';
export * from './transaction/transaction.completed.v1';
export * from './transaction/transaction.failed.v1';
export * from './transaction/transaction.initiated.v1';
export * from './transaction/transaction.list.query.v1';
export * from './transaction/transaction.list.replied.v1';
export * from './transaction/transaction.status.replied.v1';
export * from './transaction/transaction.status.requested.v1';
export * from './transaction/transfer.requested.v1';
export * from './payment/payment-view';
export * from './payment/payment.attempt.failed.v1';
export * from './payment/payment.failed.v1';
export * from './payment/payment.list.query.v1';
export * from './payment/payment.list.replied.v1';
export * from './payment/payment.status.query.v1';
export * from './payment/payment.status.replied.v1';
export * from './payment/payment.requested.v1';
export * from './payment/payment.succeeded.v1';
export * from './notification/notification-view';
export * from './notification/notification.list.query.v1';
export * from './notification/notification.list.replied.v1';
export * from './audit/audit.query.replied.v1';
export * from './audit/audit.query.requested.v1';

/**
 * Every message the system can put on the broker.
 *
 * This array is the catalogue. `docs/domain/message-catalog.md` decides *which*
 * conversations exist; this decides what each one looks like on the wire, and
 * the two are checked against each other in `test/events/`.
 */
export const catalog: readonly MessageContract[] = [
  customerActivationRequestedV1,
  customerAuthenticateRepliedV1,
  customerAuthenticateV1,
  customerEmailVerificationRejectedV1,
  customerEmailVerifiedV1,
  customerIdentityRejectedV1,
  customerIdentityValidatedV1,
  customerLoginRejectedV1,
  customerLoginSucceededV1,
  customerRegisterRejectedV1,
  customerRegisterV1,
  customerRegisteredV1,
  customerUpdateV1,
  customerUpdatedV1,
  customerValidateIdentityV1,
  customerGetQueryV1,
  customerGetRepliedV1,
  customerChangePasswordV1,
  customerPasswordChangedV1,
  customerPasswordChangeRejectedV1,
  customerPasswordResetCompletedV1,
  customerPasswordResetConfirmV1,
  customerPasswordResetIssuedV1,
  customerPasswordResetRejectedV1,
  customerPasswordResetRequestedV1,
  customerNamesQueryV1,
  customerNamesRepliedV1,
  customerPendingValidationQueryV1,
  customerPendingValidationRepliedV1,
  customerSetIdentityVerdictV1,
  customerVerifyEmailV1,
  accountBalanceQueryV1,
  accountBalanceRepliedV1,
  accountCreateV1,
  accountCreditRejectedV1,
  accountCreditRequestedV1,
  accountCreditedV1,
  accountBillersQueryV1,
  accountBillersRepliedV1,
  accountDepositV1,
  accountDepositedV1,
  accountDepositRejectedV1,
  accountDeactivatedV1,
  accountDebitCompensatedV1,
  accountDebitCompensationRequestedV1,
  accountDebitRejectedV1,
  accountDebitRequestedV1,
  accountDebitedV1,
  accountListQueryV1,
  accountListRepliedV1,
  accountOpenRejectedV1,
  accountOpenedV1,
  accountOperationsQueryV1,
  accountOperationsRepliedV1,
  accountReactivatedV1,
  accountSetStatusV1,
  transactionCompensatedV1,
  transactionCompletedV1,
  transactionFailedV1,
  transactionInitiatedV1,
  transactionListQueryV1,
  transactionListRepliedV1,
  transactionStatusRepliedV1,
  transactionStatusRequestedV1,
  transferRequestedV1,
  paymentAttemptFailedV1,
  paymentFailedV1,
  paymentListQueryV1,
  paymentListRepliedV1,
  paymentRequestedV1,
  paymentStatusQueryV1,
  paymentStatusRepliedV1,
  paymentSucceededV1,
  notificationListQueryV1,
  notificationListRepliedV1,
  auditQueryRepliedV1,
  auditQueryRequestedV1,
];

/**
 * Lookup by message name, built once and frozen.
 *
 * Duplicate names would make one contract silently shadow another, so building
 * the map is also what proves they are unique.
 */
export const catalogByName: ReadonlyMap<string, MessageContract> = (() => {
  const byName = new Map<string, MessageContract>();

  for (const contract of catalog) {
    if (byName.has(contract.name)) {
      throw new Error(`Duplicate contract name "${contract.name}" in the catalogue.`);
    }

    byName.set(contract.name, contract);
  }

  return byName;
})();

/** The contract for a message name, or `undefined` if the name is unknown. */
export function contractFor(messageType: string): MessageContract | undefined {
  return catalogByName.get(messageType);
}
