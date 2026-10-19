import { randomBytes } from 'node:crypto';

import {
  v1CancelResponse,
  v1ReversalStatus,
  v1TransferStatus,
} from '@bank/contracts';
import { currentTraceparent } from '@bank/observability';

import type { InterbankDeposit, PartnerCallback } from '../../application/interbank.ports';
import type {
  InterbankSend,
  PartnerBankClient,
  PartnerReversal,
} from '../../application/interbank-send.ports';
import type { PartnerCancel, PartnerProbe } from '../../domain/interbank-timeout';
import {
  buildCancelRequest,
  buildReversalRequest,
  buildTransferRequest,
  buildTransferResult,
} from './partner-bodies';

/**
 * La ÚNICA salida HTTP de este servicio, y del banco entero.
 *
 * Todo lo demás viaja por el broker. Esta excepción existe porque §4.1 la
 * nombra —«Payment Service envía la solicitud al API Gateway del banco
 * pareja»— y está confinada a este archivo a propósito: `test/isolation.spec.ts`
 * falla si aparece un `fetch`, `axios`, `node-fetch` o `HttpService` en
 * cualquier otro sitio del servicio, y falla también si la llamada de aquí no
 * empieza en un destino **configurado**.
 *
 * **Habla el contrato oficial del curso** (T-60): `X-Api-Key`, `traceparent` en
 * toda petición, `Idempotency-Key` igual al `interbankTransferId`, los cuerpos
 * de `partner-bodies.ts`, y las rutas `{base}/transfers`, `/transfers/{id}`,
 * `/transfers/{id}/cancel`, `/transfers/{id}/result` y `/reversals`. La base
 * (`INTERBANK_PARTNER_BASE_URL`, con el prefijo `/interbank/v1`) es la única
 * dirección que se configura: el callback no tiene variable propia porque se
 * **deriva** — «el callback siempre se envía a `{URL base del banco emisor}/
 * interbank/v1/transfers/{id}/result`» — y un banco no le pregunta al otro a
 * dónde contestar.
 *
 * Las dos direcciones del interbancario pasan por aquí, con el mismo contrato
 * de confianza: un destino fijo que viene de la configuración, y nunca del
 * cuerpo de una petición. Un adaptador que aceptara la URL del mensaje sería un
 * banco al que cualquiera le dice a dónde mandar el dinero.
 */

/**
 * Un `traceparent` nuevo (W3C Trace Context, versión `00`).
 *
 * Sólo se usa cuando no hay span activo: el contrato lo declara obligatorio en
 * **toda** petición, y una sin él es una petición que un banco estricto puede
 * rechazar con `400`. Mejor una traza nueva que ninguna — con flags `00` («no
 * muestreado») para no inventar un padre que nadie va a ver.
 */
export function newTraceparent(): string {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-00`;
}

/**
 * La única que llama a `fetch` en el servicio.
 *
 * Una sola llamada, con `this.baseUrl` por delante: la prueba de aislamiento
 * exige que el destino empiece en algo configurado, y tener un solo sitio donde
 * se construyen cabeceras —`X-Api-Key`, `traceparent`— es lo que impide que una
 * ruta nueva se olvide de una de ellas.
 */
class PartnerHttp {
  constructor(
    readonly baseUrl: string,
    readonly apiKey: string,
    readonly timeoutMs: number,
  ) {}

  get configured(): boolean {
    return this.baseUrl.length > 0 && this.apiKey.length > 0;
  }

  async call(
    method: 'GET' | 'POST',
    path: string,
    options: {
      readonly body?: unknown;
      readonly idempotencyKey?: string;
      readonly traceparent?: string | null;
    } = {},
  ): Promise<Response> {
    return await fetch(`${this.baseUrl}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-api-key': this.apiKey,
        /*
         * Obligatoria en toda petición (§4.1, Observabilidad requerida:
         * «Propagar el traceparent hacia y desde el banco pareja, para
         * relacionar un depósito entre ambos bancos con el mismo traceId»). Sale
         * del span activo; sin span se genera una, que es mejor que ninguna.
         */
        traceparent: options.traceparent ?? currentTraceparent() ?? newTraceparent(),
        ...(options.idempotencyKey === undefined
          ? {}
          : { 'idempotency-key': options.idempotencyKey }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }
}

/**
 * El tiempo límite de cada llamada HTTP al banco pareja. Exportados porque el
 * arrendamiento de los reclamos (`claim-lease.ts`) se dimensiona **a partir de
 * ellos** —un lote de 20 en serie, con el otro banco caído del todo, tarda 20
 * veces el tiempo límite— y un test comprueba que sigue alcanzando.
 */
export const PARTNER_CALLBACK_TIMEOUT_MS = 3_000;
export const PARTNER_SEND_TIMEOUT_MS = 5_000;

/** Hacia dónde responde este banco cuando RECIBE un depósito (T-46, T-60). */
export class HttpPartnerCallback implements PartnerCallback {
  readonly #http: PartnerHttp;

  constructor(
    baseUrl: string,
    apiKey: string,
    /** Nuestro código de banco: el `destinationBankCode` del `TransferResult`. */
    readonly bankCode: string,
    /** El único banco al que sabemos contestar: el de `INTERBANK_PARTNER_BASE_URL`. */
    readonly partnerBankCode: string,
    timeoutMs = PARTNER_CALLBACK_TIMEOUT_MS,
  ) {
    this.#http = new PartnerHttp(baseUrl, apiKey, timeoutMs);
  }

  async deliver(deposit: InterbankDeposit): Promise<void> {
    if (!this.#http.configured) {
      throw new Error('Interbank partner base URL or API key is not configured');
    }

    if (deposit.originBankCode !== this.partnerBankCode) {
      /*
       * Sólo sabemos dónde contestarle a un banco: el de la configuración. Un
       * depósito de otro banco no se puede devolver a ninguna parte, y adivinar
       * una dirección sería mandar un resultado a quien no lo pidió. Cambiar de
       * pareja es cambiar la configuración, no el código.
       */
      throw new Error(`No hay ruta de callback para el banco ${deposit.originBankCode}`);
    }

    const response = await this.#http.call(
      'POST',
      `/transfers/${encodeURIComponent(deposit.externalTransferId)}/result`,
      {
        body: buildTransferResult(deposit, this.bankCode),
        /*
         * Su propia traza: el callback sale desde el barrido, dentro del span
         * `payment.interbank.callback` que continúa la traza de la petición
         * original, así que `currentTraceparent()` es la correcta.
         */
      },
    );

    if (!response.ok) throw new Error(`Partner callback returned HTTP ${String(response.status)}`);
  }
}

/**
 * Hacia dónde manda este banco los depósitos que ENVÍA (T-47, T-60).
 *
 * No lanza: devuelve si el banco pareja acusó recibo. La diferencia importa —
 * un error aquí no es un rechazo del depósito sino la ausencia de una
 * respuesta, y quien decide qué hacer con esa ausencia es la función pura del
 * dominio, no este adaptador. Lo único que este archivo sabe es si la solicitud
 * llegó.
 *
 * Acusar recibo es `202 Accepted` —lo que el contrato define para un depósito
 * nuevo— **o** `200`, que es la respuesta a una solicitud repetida (mismo id y
 * mismo contenido): significa que el banco pareja ya lo tiene, y es lo que
 * contesta a un reenvío cuando se perdió el `202` original. Antes un `200` no
 * valía, con el argumento de que el callback no llegaría; en el contrato
 * oficial el callback llega siempre, así que no acusar recibo de algo que ya
 * tienen sólo alargaba la espera.
 */
export class HttpPartnerBankClient implements PartnerBankClient {
  readonly #http: PartnerHttp;

  constructor(
    baseUrl: string,
    apiKey: string,
    /** Nuestro código de banco: el `originBankCode` de lo que mandamos. */
    readonly originBankCode: string,
    timeoutMs = PARTNER_SEND_TIMEOUT_MS,
  ) {
    this.#http = new PartnerHttp(baseUrl, apiKey, timeoutMs);
  }

  async send(
    send: InterbankSend,
  ): Promise<{ readonly acknowledged: boolean; readonly detail: string | null }> {
    if (!this.#http.configured) {
      return { acknowledged: false, detail: 'PARTNER_API_KEY_NOT_CONFIGURED' };
    }

    try {
      const response = await this.#http.call('POST', '/transfers', {
        body: buildTransferRequest(send, this.originBankCode),
        /* «El header Idempotency-Key debe ser igual a interbankTransferId.» */
        idempotencyKey: send.interbankTransferId,
      });

      if (response.status === 202 || response.status === 200) {
        return { acknowledged: true, detail: null };
      }

      return { acknowledged: false, detail: `HTTP_${String(response.status)}` };
    } catch (error) {
      /*
       * Un timeout, un DNS que no resuelve, una conexión rechazada. Se devuelve
       * como ausencia de acuse y NO se propaga: si esto lanzara, el comando se
       * reencolaría y el reintento lo decidiría el broker, cuando la escalera de
       * este depósito ya está en su columna `next_attempt_at`. Dos mecanismos
       * de reintento sobre el mismo dinero es como se acredita dos veces.
       */
      return {
        acknowledged: false,
        detail: error instanceof Error ? error.name : 'SEND_FAILED',
      };
    }
  }

  /**
   * `GET /transfers/{id}` — el paso 2 del protocolo de TIMEOUT (TD-095).
   *
   * Lo que devuelve son los **hechos**, no una decisión: quién decide qué hacer
   * con ellos es `resolveTimeout`, que es puro. Aquí sólo se traduce HTTP a
   * vocabulario del dominio, y las tres traducciones son las que importan:
   *
   * - `200` con un cuerpo válido → lo que el otro banco dice.
   * - `404` → `UNKNOWN`. **No es un rechazo**: dice que no conocen el depósito,
   *   y el protocolo manda cancelar igual para dejar constancia.
   * - cualquier otra cosa, incluido un cuerpo que no cumple el contrato →
   *   `UNREACHABLE`. Un cuerpo ilegible es exactamente tan informativo como el
   *   silencio, y tratarlo como respuesta sería decidir sobre dinero a partir de
   *   algo que no se entiende.
   */
  async probe(send: InterbankSend): Promise<PartnerProbe> {
    if (!this.#http.configured) {
      return { kind: 'UNREACHABLE' };
    }

    try {
      const response = await this.#http.call(
        'GET',
        `/transfers/${encodeURIComponent(send.interbankTransferId)}`,
      );

      if (response.status === 404) {
        return { kind: 'UNKNOWN' };
      }

      if (response.status !== 200) {
        return { kind: 'UNREACHABLE' };
      }

      const parsed = v1TransferStatus.safeParse(await response.json());

      return parsed.success
        ? { kind: 'ANSWERED', status: parsed.data.status }
        : { kind: 'UNREACHABLE' };
    } catch {
      return { kind: 'UNREACHABLE' };
    }
  }

  /**
   * `POST /transfers/{id}/cancel` — el paso 3 (TD-095).
   *
   * Un `404` aquí se trata como **`UNREACHABLE`** y no como una cancelación
   * conseguida, aunque sea tentador: el contrato define exactamente tres
   * respuestas a una cancelación, y un `404` no es ninguna. Deducir de él que
   * «no lo conocen, luego no lo acreditarán» sería decidir liberar dinero a
   * partir de una inferencia sobre el enrutado del otro banco. Con
   * `UNREACHABLE`, quien decide es el margen — y la liberación sale marcada
   * como no verificada y con su alerta, que es lo honesto.
   */
  async cancel(send: InterbankSend): Promise<PartnerCancel> {
    if (!this.#http.configured) {
      return { kind: 'UNREACHABLE' };
    }

    try {
      const response = await this.#http.call(
        'POST',
        `/transfers/${encodeURIComponent(send.interbankTransferId)}/cancel`,
        { body: buildCancelRequest(this.originBankCode) },
      );

      if (response.status !== 200) {
        return { kind: 'UNREACHABLE' };
      }

      const parsed = v1CancelResponse.safeParse(await response.json());

      return parsed.success
        ? { kind: 'ANSWERED', result: parsed.data.result }
        : { kind: 'UNREACHABLE' };
    } catch {
      return { kind: 'UNREACHABLE' };
    }
  }

  /**
   * `POST /reversals` — el paso 5 del contrato (T-60).
   *
   * `202` es «solicitud recibida» y trae el `ReversalStatus`. `400`/`404` son
   * una negativa (no conocen el depósito, o el cuerpo no les vale): reintentar
   * lo mismo no cambia nada, así que se devuelve `REFUSED` y lo decide una
   * persona. Todo lo demás es «no se sabe» y se reintenta; el `reversalId` es
   * idempotente en el otro banco, así que reintentar no devuelve dos veces.
   */
  async requestReversal(send: InterbankSend, reversalId: string): Promise<PartnerReversal> {
    if (!this.#http.configured) {
      return { kind: 'UNREACHABLE' };
    }

    try {
      const response = await this.#http.call('POST', '/reversals', {
        body: buildReversalRequest(send, reversalId, this.originBankCode),
      });

      return await this.#reversalFrom(response, [202, 200]);
    } catch {
      return { kind: 'UNREACHABLE' };
    }
  }

  /** `GET /reversals/{id}`. */
  async reversalStatus(reversalId: string): Promise<PartnerReversal> {
    if (!this.#http.configured) {
      return { kind: 'UNREACHABLE' };
    }

    try {
      const response = await this.#http.call('GET', `/reversals/${encodeURIComponent(reversalId)}`);

      return await this.#reversalFrom(response, [200]);
    } catch {
      return { kind: 'UNREACHABLE' };
    }
  }

  async #reversalFrom(
    response: Response,
    accepted: readonly number[],
  ): Promise<PartnerReversal> {
    if (response.status === 400 || response.status === 404) {
      return { kind: 'REFUSED', detail: `HTTP_${String(response.status)}` };
    }

    if (!accepted.includes(response.status)) {
      return { kind: 'UNREACHABLE' };
    }

    const parsed = v1ReversalStatus.safeParse(await response.json());

    return parsed.success
      ? {
          kind: 'ANSWERED',
          status: parsed.data.status,
          refundTransferId: parsed.data.refundTransferId ?? null,
          reasonMessage: parsed.data.reasonMessage ?? null,
        }
      : { kind: 'UNREACHABLE' };
  }
}
