import { v1CancelResponse, v1TransferStatus } from '@bank/contracts';
import { currentTraceparent } from '@bank/observability';

import type { InterbankDeposit, PartnerCallback } from '../../application/interbank.ports';
import type { InterbankSend, PartnerBankClient } from '../../application/interbank-send.ports';
import type { PartnerCancel, PartnerProbe } from '../../domain/interbank-timeout';

/**
 * La ÚNICA salida HTTP de este servicio, y del banco entero.
 *
 * Todo lo demás viaja por el broker. Esta excepción existe porque §4.1 la
 * nombra —«Payment Service envía la solicitud al API Gateway del banco
 * pareja»— y está confinada a este archivo a propósito: `test/isolation.spec.ts`
 * falla si aparece un `fetch`, `axios`, `node-fetch` o `HttpService` en
 * cualquier otro sitio del servicio, y falla también si alguna de las llamadas
 * de aquí apunta a algo que no sea un destino **configurado**.
 *
 * Las dos direcciones del interbancario pasan por aquí, y las dos tienen el
 * mismo contrato de confianza: un destino fijo que viene de la configuración, y
 * nunca del cuerpo de una petición. Un adaptador que aceptara la URL del
 * mensaje sería un banco al que cualquiera le dice a dónde mandar el dinero.
 */

/** Hacia dónde responde este banco cuando RECIBE un depósito (T-46). */
export class HttpPartnerCallback implements PartnerCallback {
  constructor(
    readonly endpoint: string,
    readonly token: string,
  ) {}

  async deliver(deposit: InterbankDeposit): Promise<void> {
    if (this.token.length === 0) throw new Error('Interbank partner token is not configured');
    const payload = deposit.origin.payload;
    const response = await fetch(this.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(3_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({
        depositId: deposit.depositId,
        interbankTransferId: payload.interbankTransferId,
        originBankCode: payload.originBankCode,
        destinationBankCode: payload.destinationBankCode,
        status: deposit.stage,
        reason: deposit.reason,
      }),
    });
    if (!response.ok) throw new Error(`Partner callback returned HTTP ${response.status}`);
  }
}

/**
 * Hacia dónde manda este banco los depósitos que ENVÍA (T-47).
 *
 * No lanza: devuelve si el banco pareja acusó recibo. La diferencia importa —
 * un error aquí no es un rechazo del depósito sino la ausencia de una
 * respuesta, y quien decide qué hacer con esa ausencia es la función pura del
 * dominio, no este adaptador. Lo único que este archivo sabe es si la solicitud
 * llegó.
 *
 * Acusar recibo es exactamente `202 Accepted`, el código que §4.1 fija para
 * este flujo. Un `200` no vale: significaría que el otro banco ya decidió, y
 * entonces su callback —que es de donde sale la decisión— no llegaría nunca y
 * el depósito se quedaría esperando hasta vencer.
 */
export class HttpPartnerBankClient implements PartnerBankClient {
  constructor(
    readonly endpoint: string,
    readonly token: string,
    readonly originBankCode: string,
    readonly timeoutMs = 5_000,
    /**
     * La base de la API del banco pareja, para los dos pasos del protocolo de
     * TIMEOUT (TD-095): `GET /transfers/{id}` y `POST /transfers/{id}/cancel`.
     *
     * Cuando no se configura, se **deriva** de `endpoint` quitándole el último
     * segmento. Funciona porque el contrato pone los tres caminos al mismo
     * nivel (`/transfers`, `/transfers/{id}`, `/transfers/{id}/cancel`), y es lo
     * que permite que un despliegue existente gane el protocolo sin una
     * variable nueva. Se puede fijar explícitamente cuando el banco pareja
     * ponga su API en otra parte, que es cosa del acuerdo y no del código.
     */
    readonly apiBaseUrl: string = endpoint.replace(/\/[^/]*$/, ''),
  ) {}

  async send(
    send: InterbankSend,
  ): Promise<{ readonly acknowledged: boolean; readonly detail: string | null }> {
    if (this.token.length === 0) {
      return { acknowledged: false, detail: 'PARTNER_TOKEN_NOT_CONFIGURED' };
    }

    /**
     * El `traceparent` hacia el otro banco (§4.1, Observabilidad requerida:
     * «Propagar el traceparent hacia y desde el banco pareja, para relacionar
     * un depósito entre ambos bancos con el mismo traceId»). Sale del span
     * activo; si no hay SDK registrado es `null` y no se manda una cabecera
     * vacía, que es peor que no mandarla.
     */
    const traceparent = currentTraceparent();

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
          /*
           * La clave de idempotencia también va en la cabecera, además del
           * cuerpo: es la convención de la industria para esto (Stripe la
           * documenta así, y el enunciado la cita), y hay bancos que la leen de
           * ahí. Mandarla en los dos sitios no cuesta nada y evita una
           * negociación.
           */
          'idempotency-key': send.idempotencyKey,
          ...(traceparent === null ? {} : { traceparent }),
        },
        body: JSON.stringify({
          interbankTransferId: send.interbankTransferId,
          idempotencyKey: send.idempotencyKey,
          originBankCode: this.originBankCode,
          destinationBankCode: send.destinationBankCode,
          accountId: send.destinationAccount,
          amount: send.amount,
          timestamp: send.createdAt.toISOString(),
        }),
      });

      if (response.status === 202) {
        return { acknowledged: true, detail: null };
      }

      return { acknowledged: false, detail: `HTTP_${response.status}` };
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
    if (this.token.length === 0) {
      return { kind: 'UNREACHABLE' };
    }

    const traceparent = currentTraceparent();

    try {
      const response = await fetch(
        `${this.apiBaseUrl}/transfers/${encodeURIComponent(send.interbankTransferId)}`,
        {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${this.token}`,
            ...(traceparent === null ? {} : { traceparent }),
          },
        },
      );

      if (response.status === 404) {
        return { kind: 'UNKNOWN' };
      }

      if (response.status !== 200) {
        return { kind: 'UNREACHABLE' };
      }

      const parsed = v1TransferStatus.safeParse(await response.json());

      return parsed.success ? { kind: 'ANSWERED', status: parsed.data.status } : { kind: 'UNREACHABLE' };
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
    if (this.token.length === 0) {
      return { kind: 'UNREACHABLE' };
    }

    const traceparent = currentTraceparent();

    try {
      const response = await fetch(
        `${this.apiBaseUrl}/transfers/${encodeURIComponent(send.interbankTransferId)}/cancel`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: `Bearer ${this.token}`,
            'idempotency-key': send.idempotencyKey,
            ...(traceparent === null ? {} : { traceparent }),
          },
          body: JSON.stringify({ reason: 'ORIGIN_TIMEOUT' }),
        },
      );

      if (response.status !== 200) {
        return { kind: 'UNREACHABLE' };
      }

      const parsed = v1CancelResponse.safeParse(await response.json());

      return parsed.success ? { kind: 'ANSWERED', result: parsed.data.result } : { kind: 'UNREACHABLE' };
    } catch {
      return { kind: 'UNREACHABLE' };
    }
  }
}
