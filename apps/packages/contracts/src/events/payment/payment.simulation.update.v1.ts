import { z } from 'zod';

import { defineContract } from '../contract';

/** The most a simulated provider may take to answer, in milliseconds. */
export const MAX_SIMULATED_LATENCY_MS = 30_000;

const percent = z.number().min(0).max(100);

/**
 * The three numbers that decide how the simulated provider behaves.
 *
 * Declared once and reused by the update command and the reply, so what an
 * administrator can set and what Payment Service reports back cannot drift.
 */
export const simulationParameters = z.object({
  /** Share of attempts, 0–100, the provider answers with a transient failure. */
  failureRatePercent: percent,
  /** Share of attempts, 0–100, the provider does not answer at all. */
  timeoutRatePercent: percent,
  /** How long, in milliseconds, the provider takes to answer. */
  latencyMs: z.int().min(0).max(MAX_SIMULATED_LATENCY_MS),
});

/**
 * "Change how the provider misbehaves, now." — sent by the Gateway for an
 * administrator, applied by Payment Service without a restart (Fase 3, §4.1 —
 * Payment Service, T-44).
 *
 * Either all three parameters or `reset: true`, never a mixture and never a
 * partial set. A partial update would need Payment Service to merge it with the
 * current values and then refuse a sum over 100 % with a reply the contract has
 * no shape for; requiring the whole set keeps the refusal where the data is,
 * which is here.
 *
 * `reset` returns the simulation to the values the ConfigMap supplied, so the
 * deployment's own configuration stays reachable after somebody has overridden
 * it at run time.
 *
 * A failure and a timeout are two ways one attempt can go wrong, so together
 * they cannot exceed 100 %.
 */
export const paymentSimulationUpdateV1 = defineContract({
  name: 'payment.simulation.update.v1',
  category: 'command',
  producer: 'gateway',
  consumers: ['payment-service'],
  schema: z.union([
    z.strictObject({ reset: z.literal(true) }),
    simulationParameters.strict().refine((value) => value.failureRatePercent + value.timeoutRatePercent <= 100, {
      message: 'failureRatePercent + timeoutRatePercent must not exceed 100',
      path: ['timeoutRatePercent'],
    }),
  ]),
});

export type PaymentSimulationUpdateV1 = z.infer<typeof paymentSimulationUpdateV1.schema>;
