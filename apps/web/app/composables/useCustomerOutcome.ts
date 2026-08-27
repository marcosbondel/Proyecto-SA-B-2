import { outcomeFromAudit } from '../lib/customer';

export type { AcceptedCommand } from './useCommandOutcome';

/**
 * `useCommandOutcome`, told which messages end a customer command.
 *
 * The waiting used to live here and was extracted when T-17 needed the same
 * behaviour for accounts. Nothing about it changed: `PENDING` on a `202`, the
 * audit trail polled only when D-06 allows it, a timeout that is not a failure.
 * What is specific to this module is one line — which message names count as a
 * verdict — and that is now the only thing this file says.
 *
 * The one behaviour worth restating because it looks like a bug: registration
 * from `/registro` happens with **no session**, so the trail cannot be read and
 * the state stays `PENDING`. That is honest — the command is in the system and
 * the activation email is the next signal — and it is exactly what the Claude
 * Design prototype shows in `show.regSent`. It is recorded as TD-021.
 */
export function useCustomerOutcome() {
  return useCommandOutcome(outcomeFromAudit);
}
