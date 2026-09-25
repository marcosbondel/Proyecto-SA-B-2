import { z } from 'zod';

import { uuidV4 } from '../../schemas/primitives';
import { defineContract } from '../contract';

/**
 * Registers or updates a customer's KYC verdict (Fase 2, §4.1 p. 4:
 * "Registrar estado del cliente" / "Actualizar estado del cliente").
 *
 * Distinct from `customer.set-identity-verdict.v1`: that command is a
 * teller's review of the document photo (Fase 1); this one is the broader
 * compliance decision that gates initiating a transaction. Authorisation
 * (staff only) is the owning service's, made from the envelope identity.
 *
 * `VERIFIED` is terminal (the domain refuses to re-open an already-verified
 * customer), so a second approval is a no-op rather than a way to swap in a
 * different verdict.
 */
export const customerSetKycStatusV1 = defineContract({
  name: 'customer.set-kyc-status.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['customer-service'],
  schema: z.object({
    customerId: uuidV4,
    status: z.enum(['VERIFIED', 'REJECTED']),
  }),
});

export type CustomerSetKycStatusV1 = z.infer<typeof customerSetKycStatusV1.schema>;
