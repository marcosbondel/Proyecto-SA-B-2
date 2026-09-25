import type { TransactionStatus } from './transaction';

/**
 * The three states Fase 2 of the assignment names, as a **projection** of the
 * six the Saga actually has — never a replacement for them.
 *
 * The machine in `transaction.ts` stays at six states because that is what the
 * diagram, the `CHECK` on `transactions.status` and `@bank/contracts` all agree
 * on. Fase 2's vocabulary is coarser and answers a different question — "is
 * this transfer still moving, did it land, or did it not" — so it is computed
 * from the real status rather than stored anywhere. A stored `phaseStatus`
 * would be a second source of truth that a bug could disagree with the first.
 */
export type PhaseStatus = 'PENDING' | 'APPROVED' | 'FAILED';

/**
 * One entry per `TransactionStatus`, so the compiler refuses a build the day a
 * seventh state is added without deciding which phase it belongs to.
 *
 * `FAILED` and `COMPENSATED` both collapse to `FAILED`. They are not the same
 * incident — one never moved the money, the other moved it and brought it
 * back — but Fase 2's three-state vocabulary has no room for that distinction,
 * and losing it here is acceptable only because it is not lost anywhere else:
 * `status` and the transition history both still say which of the two
 * happened.
 */
const PHASE_OF: Readonly<Record<TransactionStatus, PhaseStatus>> = {
  PENDING: 'PENDING',
  DEBITING: 'PENDING',
  PAYMENT_PENDING: 'PENDING',
  COMPLETED: 'APPROVED',
  FAILED: 'FAILED',
  COMPENSATED: 'FAILED',
};

/** Fase 2's vocabulary, for a status this service actually stores. */
export function phaseStatusOf(status: TransactionStatus): PhaseStatus {
  return PHASE_OF[status];
}

/**
 * The inverse: every stored status that reads as one Fase 2 phase.
 *
 * Derived from `PHASE_OF` by inversion rather than kept as a second table —
 * two tables that must agree can drift, one table cannot.
 */
export function statusesInPhase(phase: PhaseStatus): readonly TransactionStatus[] {
  return (Object.keys(PHASE_OF) as TransactionStatus[]).filter(
    (status) => PHASE_OF[status] === phase,
  );
}
