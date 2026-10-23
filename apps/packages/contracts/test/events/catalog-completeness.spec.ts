import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { catalog, catalogByName } from '../../src/events';
import { messageTypeName, versionOf } from '../../src/schemas/primitives';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const DOMAIN_CATALOGUE = join(REPO_ROOT, 'docs', 'domain', 'message-catalog.md');

/**
 * The names the domain catalogue lists, read out of the document itself.
 *
 * Reading the markdown rather than hard-coding a list is the point: if somebody
 * renames a message in the domain catalogue without contracting it, this test
 * fails instead of the two documents drifting apart in silence. Since T-61 the
 * document is the literal inventory of every contract, versioned names included.
 */
function namesFromDomainCatalogue(): string[] {
  const markdown = readFileSync(DOMAIN_CATALOGUE, 'utf8');
  const names = new Set<string>();

  for (const line of markdown.split('\n')) {
    // Only the first cell of a table row names a message.
    const match = /^\|\s*`([a-z][a-z0-9.-]*)`/.exec(line);
    if (match?.[1] !== undefined && match[1].includes('.')) {
      names.add(match[1]);
    }
  }

  return [...names].sort();
}

describe('the catalogue as a whole', () => {
  it('contracts every message, and exactly the number the spec fixed', () => {
    expect(catalog).toHaveLength(134);
  });

  it('gives every message a version suffix, so it can be routed by version', () => {
    for (const contract of catalog) {
      expect(messageTypeName.safeParse(contract.name).success).toBe(true);
      expect(versionOf(contract.name)).toBe(1);
    }
  });

  it('has no duplicate names, which would let one contract shadow another', () => {
    expect(catalogByName.size).toBe(catalog.length);
  });

  it('gives every command exactly one handler', () => {
    for (const contract of catalog.filter((c) => c.category === 'command')) {
      expect(contract.consumers).toHaveLength(1);
    }
  });

  it('leaves no event without a consumer', () => {
    for (const contract of catalog.filter((c) => c.category === 'event')) {
      expect(contract.consumers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('addresses every reply to exactly one asker', () => {
    for (const contract of catalog.filter((c) => c.category === 'reply')) {
      expect(contract.consumers).toHaveLength(1);
    }
  });
});

describe('coherence with the domain catalogue', () => {
  const inventory = namesFromDomainCatalogue();

  it('lists every contracted message', () => {
    const missing = catalog.map((c) => c.name).filter((name) => !inventory.includes(name));

    expect(missing).toEqual([]);
  });

  it('lists nothing that is not contracted', () => {
    expect(inventory.filter((name) => !catalogByName.has(name))).toEqual([]);
  });
});

/**
 * The 35 messages T-02 fixed. The domain catalogue listed exactly these until
 * T-61 turned it into the inventory of all 134 (`9103754`); the list now lives
 * here so the extension record below keeps the line it is drawn against.
 */
const T02_NAMES = [
  'account.balance.query',
  'account.create',
  'account.credit.rejected',
  'account.credit.requested',
  'account.credited',
  'account.deactivated',
  'account.debit.compensated',
  'account.debit.compensation.requested',
  'account.debit.rejected',
  'account.debit.requested',
  'account.debited',
  'account.opened',
  'account.reactivated',
  'account.set-status',
  'customer.activation.requested',
  'customer.authenticate',
  'customer.email.verified',
  'customer.identity.rejected',
  'customer.identity.validated',
  'customer.login.rejected',
  'customer.login.succeeded',
  'customer.register',
  'customer.registered',
  'customer.update',
  'customer.updated',
  'customer.validate-identity',
  'customer.verify-email',
  'payment.failed',
  'payment.requested',
  'payment.succeeded',
  'transaction.compensated',
  'transaction.completed',
  'transaction.failed',
  'transaction.initiated',
  'transfer.requested',
];

describe('coherence with the 35 messages T-02 closed', () => {
  const domainNames = T02_NAMES;

  it('keeps the 35 messages T-02 fixed', () => {
    expect(new Set(domainNames).size).toBe(35);
  });

  it('contracts every one of them, with a version suffix', () => {
    const missing = domainNames.filter((name) => !catalogByName.has(`${name}.v1`));

    expect(missing).toEqual([]);
  });

  it('adds exactly the ninety-five messages recorded as an extension, and no others', () => {
    const known = new Set(domainNames.map((name) => `${name}.v1`));
    const added = catalog.map((c) => c.name).filter((name) => !known.has(name));

    expect(added.sort()).toEqual([
      /*
       * Added by T-42 (Fase 3, §4.1 — Account Service). A signal that an account
       * was used more often than the configured limit allows. It reports and
       * does not block, and is published at most once per account per window.
       */
      'account.anomaly.detected.v1',
      'account.balance.replied.v1',
      /*
       * The two that make the prototype's `G-01` "pago de servicios" possible.
       * A service payment **is a transfer** — to an account the biller holds at
       * this bank — so the catalogue needed no new money movement, no nullable
       * target account and no branch in the state machine. What it needed was a
       * way to ask which billers exist and where their collection accounts are,
       * because an account id compiled into a browser bundle is an account id
       * that is wrong the first time anything is reseeded.
       */
      'account.billers.query.v1',
      'account.billers.replied.v1',
      /*
       * Added by T-27 (Fase 2, §4.1 p. 6). Published alongside
       * `account.debited.v1`, never folded into it, so the Saga's own amount
       * never grows by a fee it did not ask to move.
       */
      'account.commission.charged.v1',
      // The five added by T-17. Three of them exist because the assignment's
      // screens need data the catalogue could not carry: a list of accounts,
      // the movements of one, and the refusal of an opening that until now
      // produced silence.
      /*
       * The three added for the prototype's `A-05`, the deposit window. A
       * deposit is the one movement with no counterparty — nothing to debit,
       * nothing to compensate, no second service that has to agree — so it is
       * an Account Service command rather than a Saga. Routing it through
       * Transaction Service would mean a transfer with a null source account
       * and a state machine with a path that never fails, which is how an
       * orchestrator becomes the "god object" §4.1 penalises.
       */
      'account.deposit.rejected.v1',
      'account.deposit.v1',
      'account.deposited.v1',
      'account.interbank.credit.rejected.v1',
      'account.interbank.credit.requested.v1',
      'account.interbank.credited.v1',
      'account.interbank.eligibility.query.v1',
      'account.interbank.eligibility.replied.v1',
      'account.list.query.v1',
      'account.list.replied.v1',
      'account.open.rejected.v1',
      'account.operations.query.v1',
      'account.operations.replied.v1',
      /*
       * The ten that make `D-01` and `D-02` honest — one count query per owning
       * service, because each service is the only one that has its own rows.
       * The alternative was a dashboard that counted the rows a listing
       * happened to return and drew the result as a bank-wide total, which is a
       * number nobody can reproduce and everybody will quote.
       */
      'account.stats.query.v1',
      'account.stats.replied.v1',
      /*
       * Added by T-45 (Fase 3, §4.1 — Notification & Audit Service). What the
       * monitoring stack says about an SLO reaches the audit trail and the
       * operators through the Gateway's webhook, as a command.
       */
      'alert.slo.received.v1',
      'audit.events.list.query.v1',
      'audit.events.list.replied.v1',
      'audit.query.replied.v1',
      'audit.query.requested.v1',
      'audit.stats.query.v1',
      'audit.stats.replied.v1',
      'customer.authenticate.replied.v1',
      /*
       * The first of the three added for the prototype's `C-01`, which draws a
       * "cambiar contraseña" form the catalogue had no message for. Kept
       * separate from the reset family because the trail must be able to tell
       * "proved control of the inbox" from "knew the old password" — the two
       * outcomes sit further down, where the sort puts them.
       */
      'customer.change-password.v1',
      'customer.email.verification.rejected.v1',
      // Added by the audit remediation (US6): Customer Service's first read
      // path, so a staff member can see a customer before editing it and the
      // update form is not filled in blind.
      'customer.get.query.v1',
      'customer.get.replied.v1',
      /*
       * The document itself, which `customer.pending-validation.replied.v1`
       * already promised was "read separately" — until now nothing kept that
       * promise, and the teller's validation screen showed the declared data
       * next to a photo it had no way to fetch. `FOUND` carries a
       * `PhotoReference`, never bytes: Customer Service stages its own stored
       * document back into the object store for this one answer, the same
       * transfer buffer ADR-012 already uses for the write path, run in
       * reverse — so this reply stays under the 64 KB every other message in
       * the catalogue does.
       */
      'customer.identity-document.query.v1',
      'customer.identity-document.replied.v1',
      /*
       * Added by T-26 (Fase 2, §4.1 p. 4). Distinct from
       * `customer.identity.validated.v1` / `customer.identity.rejected.v1`,
       * which are Fase 1's document-photo review: these carry the broader KYC
       * verdict that gates initiating a transaction (C-8).
       */
      /*
       * Added by T-31: the Saga's own KYC gate. `check.requested` is
       * Transaction Service ordering the question the same way it orders a
       * debit; `checked` is Customer Service's answer, routed back onto
       * `transaction.saga` rather than a Gateway reply queue, because nobody
       * is waiting on an HTTP connection for it.
       */
      'customer.kyc.check.requested.v1',
      'customer.kyc.checked.v1',
      'customer.kyc.rejected.v1',
      'customer.kyc.verified.v1',
      'customer.list.query.v1',
      'customer.list.replied.v1',
      /*
       * The five added for the prototype's `P-07`, the password recovery the
       * assignment's flow needs and T-05 had no message for. They repeat the
       * activation flow's shape exactly — a command in, an event carrying the
       * link, a command spending it, and the two outcomes — because a second
       * shape for the same problem would be a second thing to get wrong.
       */
      /*
       * The two that close TD-026. The account tables show a `customerId`
       * where the prototype shows the holder's name, and Account Service holds
       * only the opaque reference — resolving it there would mean reading
       * Customer Service's database, which §8.2 (2.3) forbids. The Gateway asks
       * the owning service instead and composes two replies, in a batch so a
       * table of forty rows is two round trips rather than forty.
       */
      'customer.names.query.v1',
      'customer.names.replied.v1',
      // The other two of `C-01`'s three.
      'customer.password-change.rejected.v1',
      'customer.password-changed.v1',
      'customer.password-reset.completed.v1',
      'customer.password-reset.confirm.v1',
      'customer.password-reset.issued.v1',
      'customer.password-reset.rejected.v1',
      'customer.password-reset.requested.v1',
      // Also US6: the teller's queue of identities awaiting a verdict, and the
      // manual verdict itself — the human "a teller validates the document" the
      // assignment describes, distinct from the automatic photo check.
      'customer.pending-validation.query.v1',
      'customer.pending-validation.replied.v1',
      // Added by T-16: the refusal that had no message, so a duplicated
      // document produced silence rather than a rejection.
      'customer.register.rejected.v1',
      'customer.set-identity-verdict.v1',
      // Added by T-26, alongside the two events above.
      'customer.set-kyc-status.v1',
      'customer.stats.query.v1',
      'customer.stats.replied.v1',
      /*
       * The two added by T-20. Nothing could ask this service for the
       * notifications it had sent: `audit.query.requested.v1` answers one
       * correlation, and the notifications console is the operational list
       * across all of them. Restricted to `ADMINISTRADOR` at the Gateway
       * because a notification row carries a simulated recipient.
       */
      /*
       * The four that close TD-041. The prototype's `N-01` is a customer's
       * inbox with a read state; what T-20 built was the staff console. Neither
       * missing piece was small — no row said whose notification it was, and
       * nothing recorded that somebody had read something — and the first turned
       * out to be information this service was already computing and discarding.
       *
       * Separate from the console's two messages on purpose: `notificationView`
       * carries the simulated recipient of every delivery in the system, and one
       * reply shape serving both audiences would carry a field a customer must
       * never see.
       */
      'notification.inbox.query.v1',
      'notification.inbox.replied.v1',
      'notification.list.query.v1',
      'notification.list.replied.v1',
      'notification.mark-read.v1',
      'notification.read.replied.v1',
      /*
       * The five added by T-19. `payment.attempt.failed.v1` exists because the
       * catalogue described a payment as a thing that succeeds or fails once,
       * at the end, so the retry ladder that is the whole point of the
       * resilience policy was observable only in Payment Service's own logs.
       * The four query messages exist because no route could ask this service
       * anything at all: a payment could be ordered and could answer the Saga,
       * but nobody outside could look one up.
       */
      'payment.attempt.failed.v1',
      'payment.interbank.accepted.v1',
      /*
       * Los dos que T-47 añade para el depósito SALIENTE, frente a los tres de
       * T-46 que son del entrante. La decisión del banco pareja llega por
       * callback —un comando, porque dice «registra esto», y el único que
       * puede es Payment— y cada cambio de estado se publica para la auditoría,
       * que es lo que §4.1 pide cuando exige «logs de cada cambio de estado del
       * depósito» en las dos direcciones.
       */
      'payment.interbank.callback.received.v1',
      'payment.interbank.receive.v1',
      'payment.interbank.rejected.v1',
      /*
       * Las cuatro de T-60 (B10): consultar y listar los depósitos enviados, con
       * sus seis estados, para que la pantalla muestre el depósito y no sólo la
       * Saga que lo contiene.
       */
      'payment.interbank.send.list.query.v1',
      'payment.interbank.send.list.replied.v1',
      'payment.interbank.send.query.v1',
      'payment.interbank.send.replied.v1',
      'payment.interbank.sent.v1',
      /*
       * Los doce del **contrato interbancario oficial** (T-56), seis preguntas y
       * seis respuestas. Son más que los dos del flujo provisional porque el
       * contrato tiene siete operaciones y cuatro de ellas necesitan una
       * respuesta: el Gateway no puede traducir `202`, `200` y `409` sin saber
       * qué había, ni devolver un estado que no ha preguntado.
       *
       * Llevan `v1` en el nombre del mensaje —`payment.interbank.v1.…`— y no es
       * la versión del mensaje sino **la del contrato ajeno**. Si el curso
       * publica una v2, estos doce siguen existiendo y aparecen doce más: dos
       * bancos no migran de contrato el mismo día.
       */
      'payment.interbank.v1.cancel.query.v1',
      'payment.interbank.v1.cancel.replied.v1',
      'payment.interbank.v1.reconciliation.query.v1',
      'payment.interbank.v1.reconciliation.replied.v1',
      'payment.interbank.v1.result.received.v1',
      'payment.interbank.v1.reversal.query.v1',
      'payment.interbank.v1.reversal.replied.v1',
      'payment.interbank.v1.reversal.requested.v1',
      'payment.interbank.v1.status.query.v1',
      'payment.interbank.v1.status.replied.v1',
      'payment.interbank.v1.transfer.query.v1',
      'payment.interbank.v1.transfer.replied.v1',
      'payment.list.query.v1',
      'payment.list.replied.v1',
      /*
       * Added by T-44 (Fase 3, §4.1 — Payment Service). The administrator's way to
       * change how the simulated provider misbehaves without a redeploy: one
       * command to set it, one to read it, and the reply both of them share.
       */
      'payment.simulation.query.v1',
      'payment.simulation.replied.v1',
      'payment.simulation.update.v1',
      'payment.stats.query.v1',
      'payment.stats.replied.v1',
      'payment.status.query.v1',
      'payment.status.replied.v1',
      /*
       * The two that close TD-033. `GET /api/transfers/{id}` answered "how did
       * this one end" since T-18; nothing answered "which transfers are mine",
       * because a transaction holds two opaque account references and resolving
       * either to a person means reading Account Service's database (§8.2,
       * 2.3). The transfer now records who asked for it, from the envelope
       * identity that was there all along, and the listing is scoped against
       * that column — which also closes TD-035 on the single-transfer route.
       */
      'transaction.list.query.v1',
      'transaction.list.replied.v1',
      'transaction.stats.query.v1',
      'transaction.stats.replied.v1',
      'transaction.status.replied.v1',
      'transaction.status.requested.v1',
    ]);
  });
});
