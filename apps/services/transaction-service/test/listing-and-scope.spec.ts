import { transactionListRepliedV1 } from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import { GetTransactionStatusUseCase } from '../src/application/get-transaction-status.use-case';
import { ListTransactionsUseCase } from '../src/application/list-transactions.use-case';
import { RequestTransferUseCase } from '../src/application/request-transfer.use-case';
import { AdvanceSagaUseCase } from '../src/application/advance-saga.use-case';
import { mayReadTransaction } from '../src/domain/transaction';
import {
  FixedClock,
  InMemoryTransactionRepository,
  RecordingPublisher,
  RecordingTransferTelemetry,
  SequentialIds,
} from './support/in-memory';

/**
 * TD-033 and TD-035, closed by the same column.
 *
 * Neither was a missing feature so much as a missing fact: a transaction holds
 * two account references, resolving either to a person means reading Account
 * Service's database (§8.2, 2.3), and so this service could not answer "which
 * transfers are mine" and could not tell whether a reader owned the transfer
 * they were asking about. The identity was in the envelope the whole time.
 *
 * What is asserted here is the *scope*, not the SQL: that a client sees their
 * own and only their own, that staff see everything, that naming somebody
 * else's id widens nothing, and that an unauthorised read is answered
 * `NOT_FOUND` rather than "forbidden" — because a distinguishable refusal turns
 * a guessed identifier into a way to learn that it names something real.
 */

const NOW = new Date('2026-08-30T12:00:00.000Z');
const SOURCE = '11111111-1111-4111-8111-111111111101';
const TARGET = '22222222-2222-4222-8222-222222222201';

const OWNER: Identity = { customerId: '77777777-7777-4777-8777-777777777701', role: 'CLIENTE' };
const STRANGER: Identity = { customerId: '99999999-9999-4999-8999-999999999901', role: 'CLIENTE' };
const TELLER: Identity = {
  customerId: '88888888-8888-4888-8888-888888888801',
  role: 'CAJERO_RECEPTOR',
};

function world() {
  const repository = new InMemoryTransactionRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(NOW);
  const ids = new SequentialIds();
  const telemetry = new RecordingTransferTelemetry();
  const saga = new AdvanceSagaUseCase({ repository, publisher, clock, ids, telemetry });

  return {
    repository,
    publisher,
    request: new RequestTransferUseCase({ repository, publisher, saga, clock, telemetry }),
    list: new ListTransactionsUseCase({ repository, publisher }),
    status: new GetTransactionStatusUseCase({ repository, publisher }),
  };
}

/** One transfer, requested by `identity`, with its own key and id. */
async function transferBy(
  context: ReturnType<typeof world>,
  identity: Identity | null,
  suffix: string,
): Promise<string> {
  const transactionId = `33333333-3333-4333-8333-3333333333${suffix}`;

  await context.request.execute(
    {
      transactionId,
      sourceAccount: SOURCE,
      targetAccount: TARGET,
      amount: { amountMinor: 125_000, currency: 'GTQ' },
    },
    {
      messageId: `66666666-6666-4666-8666-6666666666${suffix}`,
      correlationId: `44444444-4444-4444-8444-4444444444${suffix}`,
      idempotencyKey: `key-${suffix}`,
      identity,
    },
  );

  return transactionId;
}

function rowsOf(publisher: RecordingPublisher) {
  const reply = publisher.replies.at(-1)!;

  expect(reply.messageType).toBe(transactionListRepliedV1.name);
  expect(transactionListRepliedV1.schema.safeParse(reply.payload).success).toBe(true);

  return reply.payload as { transactions: { transactionId: string }[]; total: number };
}

describe('who a transfer belongs to', () => {
  it('is recorded on the row from the envelope, at request time', async () => {
    const context = world();
    const id = await transferBy(context, OWNER, '01');

    expect(context.repository.transactions.get(id)!.customerId).toBe(OWNER.customerId);
  });

  it('is null when nobody originated it', async () => {
    const context = world();
    const id = await transferBy(context, null, '01');

    expect(context.repository.transactions.get(id)!.customerId).toBeNull();
  });
});

describe('listing transfers', () => {
  it('gives a client their own and nobody else’s', async () => {
    const context = world();
    await transferBy(context, OWNER, '01');
    await transferBy(context, STRANGER, '02');

    await context.list.execute({}, OWNER);

    const answer = rowsOf(context.publisher);

    expect(answer.transactions).toHaveLength(1);
    expect(answer.total).toBe(1);
  });

  it('gives staff everything', async () => {
    const context = world();
    await transferBy(context, OWNER, '01');
    await transferBy(context, STRANGER, '02');

    await context.list.execute({}, TELLER);

    expect(rowsOf(context.publisher).total).toBe(2);
  });

  /**
   * The filter is a request; the scope is not. A client naming somebody else's
   * `customerId` ends up with two contradictory conditions and an empty list —
   * never a widened one, and never a `403` that would confirm the id exists.
   */
  it('does not let a client widen the scope by naming another customer', async () => {
    const context = world();
    await transferBy(context, OWNER, '01');
    await transferBy(context, STRANGER, '02');

    await context.list.execute({ customerId: STRANGER.customerId }, OWNER);

    const answer = rowsOf(context.publisher);

    expect(answer.transactions).toEqual([]);
    expect(answer.total).toBe(0);
  });

  it('lets staff narrow to one customer', async () => {
    const context = world();
    await transferBy(context, OWNER, '01');
    await transferBy(context, STRANGER, '02');

    await context.list.execute({ customerId: STRANGER.customerId }, TELLER);

    expect(rowsOf(context.publisher).total).toBe(1);
  });

  /**
   * An unauthenticated message on the command exchange is answered with
   * nothing, not with the whole table. "Nobody" is not "everybody".
   */
  it('answers an envelope with no identity with an empty list', async () => {
    const context = world();
    await transferBy(context, OWNER, '01');

    await context.list.execute({}, null);

    expect(rowsOf(context.publisher).total).toBe(0);
  });

  it('says how many exist, even when it returns fewer', async () => {
    const context = world();
    await transferBy(context, OWNER, '01');
    await transferBy(context, OWNER, '02');

    await context.list.execute({ limit: 1 }, OWNER);

    const answer = rowsOf(context.publisher);

    expect(answer.transactions).toHaveLength(1);
    expect(answer.total).toBe(2);
  });
});

describe('reading one transfer', () => {
  it('is answered for its owner', async () => {
    const context = world();
    const id = await transferBy(context, OWNER, '01');

    await context.status.execute({ transactionId: id }, OWNER);

    expect(context.publisher.replies.at(-1)!.payload).toMatchObject({ outcome: 'FOUND' });
  });

  /**
   * `NOT_FOUND`, not "forbidden". The identifier is a UUID v4, and an answer
   * that distinguished the two would turn a guessed one into a way to learn
   * that it names something real.
   */
  it('is NOT_FOUND for a stranger, indistinguishable from an id that does not exist', async () => {
    const context = world();
    const id = await transferBy(context, OWNER, '01');

    await context.status.execute({ transactionId: id }, STRANGER);
    const refused = context.publisher.replies.at(-1)!.payload;

    await context.status.execute(
      { transactionId: '00000000-0000-4000-8000-000000000000' },
      STRANGER,
    );
    const missing = context.publisher.replies.at(-1)!.payload;

    expect(refused).toEqual({ outcome: 'NOT_FOUND' });
    expect(refused).toEqual(missing);
  });

  it('is answered for staff, whoever asked for the transfer', async () => {
    const context = world();
    const id = await transferBy(context, OWNER, '01');

    await context.status.execute({ transactionId: id }, TELLER);

    expect(context.publisher.replies.at(-1)!.payload).toMatchObject({ outcome: 'FOUND' });
  });

  /**
   * A transfer with no recorded originator — a row from before the column
   * existed — is readable by staff alone. Guessing which client it belonged to
   * would be worse than showing nobody.
   */
  it('is staff-only when nobody is recorded as the originator', () => {
    expect(mayReadTransaction(OWNER, { customerId: null })).toBe(false);
    expect(mayReadTransaction(TELLER, { customerId: null })).toBe(true);
    expect(mayReadTransaction(null, { customerId: OWNER.customerId })).toBe(false);
  });

  it('carries the real history, oldest first, only after the ownership check has already let the reader in', async () => {
    const context = world();
    const id = await transferBy(context, OWNER, '01');

    await context.status.execute({ transactionId: id }, OWNER);
    const found = context.publisher.replies.at(-1)!.payload as {
      transitions: { from: string | null; to: string }[];
    };

    /**
     * Two rows: the opening one `start()` writes, and the `KYC_CHECK_ORDERED`
     * self-transition takes in the same call that accepted the request — the
     * one transition with no message of its own (see `saga-transfer.md`). It
     * stays `PENDING`: the gate's own verdict has not arrived in this test.
     */
    expect(found.transitions).toEqual([
      {
        from: null,
        to: 'PENDING',
        event: 'transfer.requested.v1',
        reason: null,
        occurredAt: expect.any(String),
      },
      {
        from: 'PENDING',
        to: 'PENDING',
        event: 'transfer.requested.v1',
        reason: null,
        occurredAt: expect.any(String),
      },
    ]);
  });

  it('carries phaseStatus alongside status', async () => {
    const context = world();
    const id = await transferBy(context, OWNER, '01');

    await context.status.execute({ transactionId: id }, OWNER);
    const found = context.publisher.replies.at(-1)!.payload as { phaseStatus: string };

    // PENDING (the status right after acceptance, awaiting the KYC verdict)
    // is, unsurprisingly, the PENDING phase.
    expect(found.phaseStatus).toBe('PENDING');
  });
});

describe('filtering the history by date and phase (T-28)', () => {
  const EARLY = new Date('2026-08-01T00:00:00.000Z');
  const LATE = new Date('2026-08-30T00:00:00.000Z');

  /** One transfer, backdated by rewriting `createdAt` after `transferBy` wrote it. */
  async function transferOn(
    context: ReturnType<typeof world>,
    identity: Identity,
    suffix: string,
    createdAt: Date,
  ): Promise<string> {
    const id = await transferBy(context, identity, suffix);
    const original = context.repository.transactions.get(id)!;

    context.repository.transactions.set(id, { ...original, createdAt });

    return id;
  }

  it('filters by date range alone', async () => {
    const context = world();
    await transferOn(context, OWNER, '01', EARLY);
    await transferOn(context, OWNER, '02', LATE);

    await context.list.execute(
      { from: '2026-08-15T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z' },
      OWNER,
    );

    expect(rowsOf(context.publisher).total).toBe(1);
  });

  /**
   * `transferBy` runs the request through `RequestTransferUseCase`, which
   * orders `KYC_CHECK_ORDERED` in the same call that accepts the request — a
   * self-transition, so by the time the row exists it still reads `PENDING`,
   * with nobody's verdict having arrived in this test. `PENDING` is the
   * `PENDING` phase (see `phase-status.ts`), which is what these tests filter
   * by.
   */
  it('filters by status alone, unaffected by date', async () => {
    const context = world();
    await transferOn(context, OWNER, '01', EARLY);
    await transferOn(context, OWNER, '02', LATE);

    await context.list.execute({ status: 'PENDING' }, OWNER);

    expect(rowsOf(context.publisher).total).toBe(2);
  });

  it('combines date and status: both must hold', async () => {
    const context = world();
    await transferOn(context, OWNER, '01', EARLY);
    await transferOn(context, OWNER, '02', LATE);

    await context.list.execute(
      { status: 'PENDING', from: '2026-08-15T00:00:00.000Z' },
      OWNER,
    );

    expect(rowsOf(context.publisher).total).toBe(1);
  });

  it('resolves phaseStatus to its member statuses', async () => {
    const context = world();
    await transferOn(context, OWNER, '01', EARLY);

    await context.list.execute({ phaseStatus: 'PENDING' }, OWNER);

    expect(rowsOf(context.publisher).total).toBe(1);

    await context.list.execute({ phaseStatus: 'APPROVED' }, OWNER);

    expect(rowsOf(context.publisher).total).toBe(0);
  });

  it('intersects status and phaseStatus rather than letting one override the other', async () => {
    const context = world();
    await transferOn(context, OWNER, '01', EARLY);

    // PENDING is in the PENDING phase — the intersection is non-empty.
    await context.list.execute({ status: 'PENDING', phaseStatus: 'PENDING' }, OWNER);

    expect(rowsOf(context.publisher).total).toBe(1);

    // PENDING is never APPROVED — the intersection is empty, not a widened match.
    await context.list.execute({ status: 'PENDING', phaseStatus: 'APPROVED' }, OWNER);

    expect(rowsOf(context.publisher).total).toBe(0);
  });

  it('replies with phaseStatus on every row', async () => {
    const context = world();
    await transferOn(context, OWNER, '01', EARLY);

    await context.list.execute({}, OWNER);

    const answer = rowsOf(context.publisher) as unknown as {
      transactions: { phaseStatus: string }[];
    };

    expect(answer.transactions[0]!.phaseStatus).toBe('PENDING');
  });
});
