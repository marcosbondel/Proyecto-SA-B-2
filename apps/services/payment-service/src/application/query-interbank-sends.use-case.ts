import {
  paymentInterbankSendListRepliedV1,
  paymentInterbankSendRepliedV1,
} from '@bank/contracts';
import type {
  Identity,
  InterbankSendView,
  PaymentInterbankSendListQueryV1,
} from '@bank/contracts';

import type { InterbankSend, InterbankSendRepository } from './interbank-send.ports';
import type { EventPublisher } from './ports';

/** Cuántos depósitos devuelve un listado si el Gateway no pide otra cosa. */
const DEFAULT_LIMIT = 50;

/**
 * Las dos preguntas que este servicio contesta sobre los depósitos que **envió**
 * al banco pareja (T-60, B10).
 *
 * **Aquí sí se acota por quien pregunta.** A diferencia de `payment.list`, que
 * Payment no puede acotar porque su fila no sabe de qué cliente es (TD-037), la
 * fila del depósito enviado guarda el cliente que lo pidió —sale de la identidad
 * del sobre que ya traía el comando—, así que un `CLIENTE` ve los suyos y el
 * personal ve todos sin que este servicio lea una tabla ajena.
 *
 * Un depósito de otro cliente se contesta `NOT_FOUND`, igual que uno que no
 * existe: distinguirlos regalaría una forma de averiguar qué depósitos hay.
 */
export class QueryInterbankSendsUseCase {
  readonly #repository: InterbankSendRepository;

  constructor(dependencies: { repository: InterbankSendRepository }) {
    this.#repository = dependencies.repository;
  }

  /** `payment.interbank.send.query.v1` → `payment.interbank.send.replied.v1`. */
  public async one(
    interbankTransferId: string,
    identity: Identity | null,
    publisher: EventPublisher,
  ): Promise<void> {
    const send = await this.#repository.find(interbankTransferId);

    if (send === null || !mayRead(identity, send)) {
      await publisher.reply({
        messageType: paymentInterbankSendRepliedV1.name,
        payload: { outcome: 'NOT_FOUND' },
      });

      return;
    }

    const history = await this.#repository.history(interbankTransferId);

    await publisher.reply({
      messageType: paymentInterbankSendRepliedV1.name,
      payload: {
        outcome: 'FOUND',
        send: interbankSendViewOf(send),
        history: history.map((entry) => ({
          state: entry.state,
          reason: entry.reason,
          at: entry.at.toISOString(),
        })),
      },
    });
  }

  /** `payment.interbank.send.list.query.v1` → `payment.interbank.send.list.replied.v1`. */
  public async list(
    query: PaymentInterbankSendListQueryV1,
    identity: Identity | null,
    publisher: EventPublisher,
  ): Promise<void> {
    const scope = scopeOf(identity);
    const sends =
      scope === 'NONE'
        ? []
        : await this.#repository.list({
            customerId: scope === 'ALL' ? null : scope,
            ...(query.state === undefined ? {} : { state: query.state }),
            limit: query.limit ?? DEFAULT_LIMIT,
          });

    await publisher.reply({
      messageType: paymentInterbankSendListRepliedV1.name,
      payload: { sends: sends.map(interbankSendViewOf) },
    });
  }
}

/**
 * Qué puede ver quien pregunta: todo (personal), lo suyo (un cliente), o nada
 * (un mensaje sin identidad, que no es de nadie).
 */
function scopeOf(identity: Identity | null): 'ALL' | 'NONE' | string {
  if (identity === null) return 'NONE';

  return identity.role === 'CLIENTE' ? identity.customerId : 'ALL';
}

function mayRead(identity: Identity | null, send: InterbankSend): boolean {
  const scope = scopeOf(identity);

  if (scope === 'NONE') return false;

  return scope === 'ALL' || send.customerId === scope;
}

/**
 * La cuenta del banco pareja, enmascarada: los últimos cuatro caracteres.
 *
 * El operador necesita reconocerla y nadie necesita copiarla desde un listado.
 * Una cuenta de cuatro caracteres o menos se enmascara entera: enseñar la mitad
 * de un número corto es enseñarlo.
 */
export function maskAccount(account: string): string {
  if (account.length <= 4) return '*'.repeat(account.length);

  return `${'*'.repeat(account.length - 4)}${account.slice(-4)}`;
}

/** El `traceId` de un `traceparent` W3C, o `null` si no hay o está mal formado. */
export function traceIdOf(traceContext: string | null): string | null {
  const match = traceContext === null ? null : /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(traceContext);

  return match?.[1] ?? null;
}

/** Los motivos con los que un depósito se libera sin que el banco pareja lo confirme. */
const UNVERIFIED_RELEASES: readonly string[] = ['RELEASED_NO_ANSWER', 'RELEASED_UNKNOWN_AT_PARTNER'];

/** Una fila, como el contrato de la pantalla la quiere. */
export function interbankSendViewOf(send: InterbankSend): InterbankSendView {
  return {
    interbankTransferId: send.interbankTransferId,
    paymentId: send.paymentId,
    transactionId: send.transactionId,
    state: send.state,
    reason: send.reason,
    destinationBankCode: send.destinationBankCode,
    destinationAccount: maskAccount(send.destinationAccount),
    originAccount: send.originAccount,
    amount: send.amount,
    correlationId: send.correlationId,
    traceId: traceIdOf(send.traceContext),
    createdAt: send.createdAt.toISOString(),
    expiresAt: send.confirmationDueAt.toISOString(),
    sentAt: send.sentAt?.toISOString() ?? null,
    decidedAt: send.decidedAt?.toISOString() ?? null,
    reversedAt: send.reversedAt?.toISOString() ?? null,
    attempts: send.attempts,
    releasedUnverified: send.reason !== null && UNVERIFIED_RELEASES.includes(send.reason),
    reversal:
      send.reversal === null
        ? null
        : { reversalId: send.reversal.reversalId, state: send.reversal.state },
  };
}
