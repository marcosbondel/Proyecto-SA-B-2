/**
 * The trace behind each operation the screen has started (T-45).
 *
 * The Gateway answers every request with two identifiers: `X-Correlation-Id`,
 * the business flow, and `X-Trace-Id`, the technical trace — the one an operator
 * pastes into Grafana. Every screen already shows the first through
 * `SharedCorrelationIdBadge`; remembering the second *by the first* is what lets
 * that one badge show both without a single screen having to be told about
 * traces.
 *
 * Nothing here talks to the Gateway or to Vue: the part of this feature that can
 * be wrong — which trace belongs to which operation, and what is kept — is a
 * pure function, asserted on its own.
 */

/** Correlation id → trace id, oldest first. */
export type TraceLedger = Readonly<Record<string, string>>;

/**
 * How many operations are remembered. A session of a teller can make hundreds of
 * calls; the one anybody asks about is the one on screen, which is recent. The
 * bound is what stops a long session from growing a map nobody reads.
 */
export const MAX_REMEMBERED_TRACES = 200;

const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;

/**
 * What the Gateway sent, or `null`.
 *
 * Anything that is not a W3C trace id is not shown: a header that is empty, that
 * is the reserved all-zero value, or that some intermediary rewrote would
 * otherwise be rendered as if it were a trace, and somebody would search for it.
 */
export function traceIdFrom(header: string | null | undefined): string | null {
  const value = header?.trim().toLowerCase();

  return value !== undefined && TRACE_ID.test(value) ? value : null;
}

/**
 * The ledger with one more operation in it, returned rather than mutated so a
 * reactive store sees a change.
 *
 * Re-recording a correlation moves it to the newest end — the same flow can be
 * asked about twice (a retry keeps its correlation) and the latest trace is the
 * one worth showing — and the oldest fall off past the bound.
 */
export function remember(
  ledger: TraceLedger,
  correlationId: string | null,
  traceId: string | null,
): TraceLedger {
  if (correlationId === null || correlationId.length === 0 || traceId === null) {
    return ledger;
  }

  const { [correlationId]: _previous, ...rest } = ledger;
  const entries = [...Object.entries(rest), [correlationId, traceId] as const];

  return Object.fromEntries(entries.slice(-MAX_REMEMBERED_TRACES));
}

/** The trace of an operation, or `null` when the Gateway sent none. */
export function traceFor(ledger: TraceLedger, correlationId: string | null): string | null {
  return correlationId === null ? null : (ledger[correlationId] ?? null);
}
