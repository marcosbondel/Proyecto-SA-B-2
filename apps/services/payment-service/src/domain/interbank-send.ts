/**
 * Los seis estados del depósito que este banco **envía** al banco pareja
 * (Fase 3, §4.1 — Integración interbancaria; T-47).
 *
 * **Este archivo no importa nada fuera del dominio**, `@bank/contracts`
 * incluido: `pnpm lint` lo exige y el diseño está de acuerdo — si un depósito
 * se compensa o se da por bueno tiene que poder discutirse sin un broker y sin
 * una base de datos a la vista.
 *
 * La diferencia con el proveedor simulado de `provider.ts` es una sola, y es la
 * que obliga a una máquina aparte: **la respuesta no llega al momento**. El
 * banco pareja contesta `202 Accepted` —«lo tengo, ya te digo»— y su decisión
 * vuelve después por callback, o no vuelve. Así que entre «pedido» y «resuelto»
 * hay un estado que puede durar minutos, y un vencimiento que decide cuándo
 * dejar de esperar.
 *
 * Los tres finales no son sinónimos:
 *
 * - `ACCEPTED` — el otro banco acreditó. El dinero salió de aquí y llegó allá.
 * - `REJECTED` — el otro banco dijo no, con un motivo. Hay que devolverlo.
 * - `TIMEOUT` — nadie dijo nada antes del vencimiento. Hay que devolverlo
 *   **igual**, pero no es lo mismo: un rechazo es una opinión y un vencimiento
 *   es su ausencia, y confundirlos es lo que hace imposible saber si el otro
 *   banco está caído o es estricto.
 *
 * Y `REVERSED` no es un cuarto final: es la constancia de que la compensación
 * ya ocurrió. Sin él, «rechazado» y «rechazado y devuelto» serían el mismo
 * estado, que es precisamente la diferencia que §8.3 penaliza con un 50 %.
 */
export type InterbankSendState =
  | 'PENDING'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'TIMEOUT'
  | 'REVERSED';

/** Lo que puede pasarle a un depósito en vuelo. */
export type InterbankSendEvent =
  /** El banco pareja acusó recibo con `202`. Debe su respuesta. */
  | { readonly kind: 'ACKNOWLEDGED' }
  /**
   * No se pudo ni entregar la solicitud: la red, un `5xx`, un `connection
   * reset`. **No es un rechazo**: el otro banco no ha opinado, así que se
   * reintenta y el vencimiento es el que decide cuándo rendirse.
   */
  | { readonly kind: 'SEND_FAILED'; readonly detail: string }
  /** El callback dijo `ACCEPTED`. */
  | { readonly kind: 'CONFIRMED' }
  /** El callback dijo `REJECTED`, con su motivo. */
  | { readonly kind: 'REFUSED'; readonly reason: string }
  /** Venció el plazo de confirmación sin que llegara ninguna. */
  | { readonly kind: 'EXPIRED' }
  /** La compensación del débito ya ocurrió: el dinero volvió a la cuenta origen. */
  | { readonly kind: 'COMPENSATED' };

/**
 * Qué hay que decirle a la Saga, si algo.
 *
 * Son los dos mensajes que el proveedor simulado ya usa —`payment.succeeded.v1`
 * y `payment.failed.v1`— y no unos nuevos: así la compensación, el historial,
 * el estado de fase y la notificación salen de la maquinaria que ya está
 * probada. Un depósito interbancario es un pago que, visto desde la Saga, sale
 * bien o sale mal.
 */
export type SagaSettlement = 'SUCCEEDED' | 'FAILED';

/** El resultado de una transición legal. */
export interface InterbankSendTransition {
  readonly from: InterbankSendState;
  readonly state: InterbankSendState;
  readonly reason: string | null;
  readonly settle: SagaSettlement | null;
  /** `true` cuando hay que volver a intentar la entrega al banco pareja. */
  readonly resend: boolean;
}

/**
 * Un evento que no tiene lugar desde el estado en que el depósito está.
 *
 * Igual que la `IllegalTransition` de la Saga: se registra y **no** se aplica,
 * y no se reencola. Un callback que llega dos veces, o que llega después del
 * vencimiento, es consecuencia normal de un sistema distribuido con reintentos
 * — tratarlo como una avería llenaría la cola muerta de comportamiento
 * correcto.
 */
export class IllegalInterbankSendTransition extends Error {
  public readonly code = 'ILLEGAL_INTERBANK_SEND_TRANSITION' as const;
  public readonly from: InterbankSendState;
  public readonly event: InterbankSendEvent['kind'];

  constructor(from: InterbankSendState, event: InterbankSendEvent['kind']) {
    super(`"${event}" no es un evento legal para un depósito en ${from}.`);
    this.name = 'IllegalInterbankSendTransition';
    this.from = from;
    this.event = event;
  }
}

/** Los estados desde los que ya no se mueve nada, salvo la constancia de la devolución. */
const TERMINAL: readonly InterbankSendState[] = ['ACCEPTED', 'REVERSED'];

/** Dónde cae un depósito cuando ocurre `event`, o por qué no cae en ninguna parte. */
export function applyInterbankSend(
  from: InterbankSendState,
  event: InterbankSendEvent,
): InterbankSendTransition {
  const illegal = (): never => {
    throw new IllegalInterbankSendTransition(from, event.kind);
  };
  const to = (
    state: InterbankSendState,
    reason: string | null = null,
    settle: SagaSettlement | null = null,
    resend = false,
  ): InterbankSendTransition => ({ from, state, reason, settle, resend });

  if (TERMINAL.includes(from)) {
    return illegal();
  }

  switch (event.kind) {
    case 'ACKNOWLEDGED':
      /**
       * Un `202` repetido no es un error: el comando pudo reentregarse, o el
       * barrido pudo reintentar una entrega que en realidad sí había llegado.
       * Lo que no puede es mover un depósito ya resuelto, y eso lo impide el
       * corte de arriba.
       */
      if (from === 'PENDING' || from === 'SENT') {
        return to('SENT');
      }
      return illegal();

    case 'SEND_FAILED':
      // Sigue siendo nuestro: nadie ha opinado todavía. Se reintenta.
      return from === 'PENDING' ? to('PENDING', event.detail, null, true) : illegal();

    case 'CONFIRMED':
      /**
       * Sólo desde `SENT`. Un `ACCEPTED` para un depósito que nunca se entregó
       * es una respuesta a algo que no preguntamos, y aceptarla cerraría como
       * pagado un dinero que no salió.
       */
      return from === 'SENT' ? to('ACCEPTED', null, 'SUCCEEDED') : illegal();

    case 'REFUSED':
      return from === 'SENT' ? to('REJECTED', event.reason, 'FAILED') : illegal();

    case 'EXPIRED':
      /**
       * Legal desde los dos estados no resueltos, y por el mismo motivo: el
       * plazo es del DEPÓSITO, no del envío. Si venció sin haber conseguido
       * entregarlo, rendirse y devolver el dinero es la respuesta correcta —
       * seguir reintentando contra un banco que no contesta es dejar el saldo
       * del cliente retenido indefinidamente.
       */
      return from === 'PENDING' || from === 'SENT'
        ? to('TIMEOUT', 'CONFIRMATION_TIMEOUT', 'FAILED')
        : illegal();

    case 'COMPENSATED':
      /**
       * La constancia de que el dinero volvió. Legal sólo donde se pidió
       * devolverlo: un `account.debit.compensated.v1` sobre un depósito que
       * nadie mandó compensar pertenece a otra Saga, o adelantó a su propia
       * causa.
       */
      return from === 'REJECTED' || from === 'TIMEOUT' ? to('REVERSED') : illegal();
  }
}

/** `true` cuando el depósito ya no espera nada de nadie. */
export function isSendSettled(state: InterbankSendState): boolean {
  return state === 'ACCEPTED' || state === 'REVERSED';
}

/**
 * `true` cuando ya hay un veredicto sobre el depósito — lo haya dado el otro
 * banco o lo haya dado el reloj.
 *
 * Vive aquí y no en el caso de uso por la razón que la prueba de aislamiento de
 * este servicio defiende: qué significa cada estado es vocabulario del dominio,
 * y en cuanto una capa de arriba empieza a comparar esas cadenas, la decisión
 * se ha mudado a un sitio donde ya no se puede discutir sin una base de datos.
 * Es también lo que marca el final del cronómetro: el tiempo que mide la
 * métrica es desde que se pidió hasta que alguien decidió, no hasta que el
 * dinero volvió.
 */
export function isSendDecided(state: InterbankSendState): boolean {
  return state === 'ACCEPTED' || state === 'REJECTED' || state === 'TIMEOUT';
}

/**
 * Qué tiene que oír la Saga sobre un depósito ya decidido, o `null` si todavía
 * no hay nada que decirle.
 *
 * Existe para la reconciliación de TD-093, que es el único sitio donde hay que
 * reconstruir un veredicto **desde el estado de la fila** en vez de desde la
 * transición que lo produjo: el evento original se perdió al publicarlo y no
 * hay nada guardado de donde sacarlo.
 *
 * Y vive aquí, no en el caso de uso, por lo mismo que `isSendDecided`: la
 * correspondencia entre un estado del depósito y un final del pago es
 * vocabulario del dominio. Que esté en un solo sitio es lo que garantiza que un
 * veredicto reconciliado diga **exactamente** lo mismo que habría dicho el
 * original — si la tabla de `applyInterbankSend` y esta función se separaran, la
 * recuperación le contaría a la Saga una historia distinta de la que ocurrió.
 */
export function settlementOf(state: InterbankSendState): 'SUCCEEDED' | 'FAILED' | null {
  switch (state) {
    case 'ACCEPTED':
      return 'SUCCEEDED';
    case 'REJECTED':
    case 'TIMEOUT':
      return 'FAILED';
    /*
     * `PENDING` y `SENT` todavía esperan; `REVERSED` ya se contó —su veredicto
     * fue el `REJECTED` o el `TIMEOUT` del que viene— y volver a emitirlo sería
     * pedirle a la Saga un segundo final.
     */
    case 'PENDING':
    case 'SENT':
    case 'REVERSED':
      return null;
  }
}
