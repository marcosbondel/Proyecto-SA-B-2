import { remember, traceFor } from '../lib/trace';
import type { TraceLedger } from '../lib/trace';

/**
 * Which trace each operation of this session ran under (T-45).
 *
 * One ledger for the whole application, filled by `useGatewayApi` from the
 * `X-Trace-Id` header of every response and read by `SharedCorrelationIdBadge`.
 * Keyed by the correlation id because that is the identifier every screen
 * already holds for an operation: a screen that started a transfer has its
 * correlation id and nothing else, and the badge looks the trace up by it.
 *
 * Empty until the Gateway sends trace ids, which is until an OpenTelemetry SDK
 * is registered there; the badge then shows what it always showed.
 */
export function useTraces() {
  const ledger = useState<TraceLedger>('trace-ledger', () => ({}));

  return {
    ledger,

    record(correlationId: string | null, traceId: string | null): void {
      ledger.value = remember(ledger.value, correlationId, traceId);
    },

    traceOf(correlationId: string | null): string | null {
      return traceFor(ledger.value, correlationId);
    },
  };
}
