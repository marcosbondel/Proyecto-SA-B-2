import { normaliseError, isSessionFailure } from '../lib/gateway-error';
import type { GatewayError } from '../lib/gateway-error';
import { traceIdFrom } from '../lib/trace';

export interface GatewayRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH';
  readonly body?: unknown;
  /** Kept stable across retries so the receiving service can recognise them. */
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  readonly query?: Record<string, string | undefined>;
}

/** Either an answer or a failure, never a thrown surprise. */
export type GatewayResult<T> =
  | {
      readonly ok: true;
      readonly data: T;
      readonly correlationId: string | null;
      /** The trace the Gateway served it under, when an SDK recorded one (T-45). */
      readonly traceId: string | null;
    }
  | { readonly ok: false; readonly error: GatewayError };

/**
 * The only way this application talks to the Gateway.
 *
 * Every module gets four things for free, and none of them is optional
 * behaviour that a screen could reasonably reimplement differently:
 *
 * - the base URL from runtime configuration, never compiled in;
 * - the session token attached to every protected call;
 * - the seven error types normalised, so no screen parses a failure body;
 * - an expired session ended and redirected **before** the screen sees it.
 *
 * It returns a result rather than throwing. A screen that must render five
 * asynchronous states has to handle failure as data anyway; making it also
 * remember a `try`/`catch` is how one of the five silently stops working.
 */
export function useGatewayApi() {
  const config = useRuntimeConfig();
  const route = useRoute();
  const { session, end } = useSession();
  const traces = useTraces();

  async function call<T>(
    path: string,
    options: GatewayRequestOptions = {},
  ): Promise<GatewayResult<T>> {
    const headers: Record<string, string> = {};

    if (session.value !== null) {
      headers.Authorization = `Bearer ${session.value.token}`;
    }

    if (options.idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    if (options.correlationId !== undefined) {
      headers['X-Correlation-Id'] = options.correlationId;
    }

    // In browser client on HTTPS, calling an HTTP endpoint causes browser Mixed Content blocking.
    // In that case, use relative same-origin (baseURL: '') so Nitro proxies /api transparently.
    const isHttpsBrowser =
      import.meta.client &&
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:';

    const configuredBase = config.public.apiBaseUrl;
    const baseURL =
      isHttpsBrowser && typeof configuredBase === 'string' && configuredBase.startsWith('http://')
        ? ''
        : configuredBase;

    try {
      const response = await $fetch.raw<T>(path, {
        baseURL,
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: options.body as Record<string, unknown> }),
        ...(options.query === undefined ? {} : { query: options.query }),
      });

      const correlationId = response.headers.get('x-correlation-id');
      const traceId = traceIdFrom(response.headers.get('x-trace-id'));

      // Remembered by the correlation, so `SharedCorrelationIdBadge` can show the
      // trace of any operation without the screen that started it being told.
      traces.record(correlationId, traceId);

      return { ok: true, data: response._data as T, correlationId, traceId };
    } catch (cause) {
      const error = normaliseError(cause);

      // A refusal has a trace too, and it is the one somebody will be asked for.
      const failed = (cause as { response?: { headers?: Headers } }).response?.headers;

      traces.record(
        error.correlationId ?? failed?.get('x-correlation-id') ?? null,
        traceIdFrom(failed?.get('x-trace-id')),
      );

      /**
       * The session is over. Ending it here, once, is what keeps every module
       * from having to notice — and keeps "your session ended" from being
       * rendered as though the bank had refused the operation.
       *
       * Only when there *was* a session: `signIn` travels through this same
       * path, and a mistyped password is `UNAUTHENTICATED` too — that one is
       * the form's failure to render, not a session to end, and the redirect
       * would wipe the `?next=` the visitor arrived with. The visitor's
       * whereabouts ride along so that signing back in returns them there.
       *
       * `expired: '1'` is a second, explicit signal, separate from `next`.
       * `next` alone cannot mean "your session ended" — somebody can arrive at
       * `/login?next=/cuentas` from a plain link with nothing having expired —
       * so the login screen needs its own flag to know it should explain
       * itself rather than guess from where the visitor was headed.
       */
      if (isSessionFailure(error) && session.value !== null) {
        end();
        await navigateTo({ path: '/login', query: { next: route.fullPath, expired: '1' } });
      }

      return { ok: false, error };
    }
  }

  return {
    call,

    /** Signs in and starts the session. The one call that is not protected. */
    async signIn(email: string, credential: string) {
      return await call<{ token: string; expiresIn: number; correlationId: string }>(
        '/api/auth/login',
        { method: 'POST', body: { email, credential } },
      );
    },

    /**
     * How a screen finds out what became of a command it was told `202` for.
     * Restricted to `ADMINISTRADOR` by the Gateway, which will say so.
     */
    async auditFor(correlationId: string) {
      return await call<{ events: unknown[]; notifications: unknown[] }>('/api/audit', {
        query: { correlationId },
      });
    },
  };
}
