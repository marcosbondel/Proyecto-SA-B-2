/**
 * Writes the three worked examples of the transfer Saga.
 *
 * They are built with the same `createEnvelope` / `followUpEnvelope` the
 * services use and validated against the same contracts, so an example cannot
 * be subtly wrong in a way the code would reject. Hand-written examples drift;
 * these fail the build instead.
 *
 * Run after `pnpm build`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const outputDir = join(packageRoot, '..', '..', '..', 'docs', 'events', 'examples');

const { createEnvelope, followUpEnvelope } = await import(join(packageRoot, 'dist', 'envelope.js'));
const { contractFor } = await import(join(packageRoot, 'dist', 'events', 'index.js'));

const SOURCE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const TRANSACTION = '33333333-3333-4333-8333-333333333333';
const PAYMENT = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';

const IDENTITY = { customerId: CUSTOMER, role: 'CLIENTE' };
const AMOUNT = { amountMinor: 150_00, currency: 'GTQ' };
const KEY = 'transfer-2026-08-19-4471';

/** Builds a flow, validating every payload against its own contract as it goes. */
function flow(steps) {
  const messages = [];
  let previous = null;

  for (const [messageType, producer, payload] of steps) {
    const envelope =
      previous === null
        ? createEnvelope(payload, {
            messageType,
            producer,
            identity: IDENTITY,
            idempotencyKey: KEY,
          })
        : followUpEnvelope(previous, payload, { messageType, producer, idempotencyKey: KEY });

    const contract = contractFor(messageType);
    if (contract === undefined) throw new Error(`Unknown message type "${messageType}".`);

    const result = contract.schema.safeParse(payload);
    if (!result.success) {
      throw new Error(
        `Example payload for "${messageType}" does not satisfy its own contract: ${JSON.stringify(result.error.issues)}`,
      );
    }

    messages.push(envelope);
    previous = envelope;
  }

  return messages;
}

const debitRequested = [
  'account.debit.requested.v1',
  'transaction-service',
  { transactionId: TRANSACTION, accountId: SOURCE, amount: AMOUNT },
];
const opening = [
  [
    'transfer.requested.v1',
    'gateway',
    { transactionId: TRANSACTION, sourceAccount: SOURCE, targetAccount: TARGET, amount: AMOUNT },
  ],
  [
    'transaction.initiated.v1',
    'transaction-service',
    {
      transactionId: TRANSACTION,
      sourceAccount: SOURCE,
      targetAccount: TARGET,
      amount: AMOUNT,
      status: 'PENDING',
      createdAt: '2026-08-19T14:32:07.482Z',
    },
  ],
];

const happyPath = flow([
  ...opening,
  debitRequested,
  [
    'account.debited.v1',
    'account-service',
    {
      transactionId: TRANSACTION,
      accountId: SOURCE,
      amount: AMOUNT,
      balanceAfter: { amountMinor: 850_00, currency: 'GTQ' },
      debitedAt: '2026-08-19T14:32:08.100Z',
    },
  ],
  [
    'payment.requested.v1',
    'transaction-service',
    { paymentId: PAYMENT, transactionId: TRANSACTION, amount: AMOUNT },
  ],
  [
    'payment.succeeded.v1',
    'payment-service',
    {
      paymentId: PAYMENT,
      transactionId: TRANSACTION,
      status: 'SUCCEEDED',
      attempt: 1,
      succeededAt: '2026-08-19T14:32:08.900Z',
    },
  ],
  [
    'account.credit.requested.v1',
    'transaction-service',
    { transactionId: TRANSACTION, accountId: TARGET, amount: AMOUNT },
  ],
  [
    'account.credited.v1',
    'account-service',
    {
      transactionId: TRANSACTION,
      accountId: TARGET,
      amount: AMOUNT,
      balanceAfter: { amountMinor: 1_150_00, currency: 'GTQ' },
      reactivated: false,
      creditedAt: '2026-08-19T14:32:09.400Z',
    },
  ],
  [
    'transaction.completed.v1',
    'transaction-service',
    {
      transactionId: TRANSACTION,
      customerId: CUSTOMER,
      sourceAccount: SOURCE,
      targetAccount: TARGET,
      amount: AMOUNT,
      status: 'COMPLETED',
      completedAt: '2026-08-19T14:32:09.500Z',
    },
  ],
]);

const rejected = flow([
  ...opening,
  debitRequested,
  [
    'account.debit.rejected.v1',
    'account-service',
    { transactionId: TRANSACTION, accountId: SOURCE, reason: 'INSUFFICIENT_FUNDS' },
  ],
  [
    'transaction.failed.v1',
    'transaction-service',
    {
      transactionId: TRANSACTION,
      customerId: CUSTOMER,
      status: 'FAILED',
      reason: 'INSUFFICIENT_FUNDS',
      failedAt: '2026-08-19T14:32:08.200Z',
    },
  ],
]);

const compensated = flow([
  ...opening,
  debitRequested,
  [
    'account.debited.v1',
    'account-service',
    {
      transactionId: TRANSACTION,
      accountId: SOURCE,
      amount: AMOUNT,
      balanceAfter: { amountMinor: 850_00, currency: 'GTQ' },
      debitedAt: '2026-08-19T14:32:08.100Z',
    },
  ],
  [
    'payment.requested.v1',
    'transaction-service',
    { paymentId: PAYMENT, transactionId: TRANSACTION, amount: AMOUNT },
  ],
  [
    'payment.failed.v1',
    'payment-service',
    {
      paymentId: PAYMENT,
      transactionId: TRANSACTION,
      status: 'FAILED',
      attempt: 3,
      failureReason: 'PAYMENT_RETRIES_EXHAUSTED',
      failedAt: '2026-08-19T14:32:39.000Z',
    },
  ],
  [
    'account.debit.compensation.requested.v1',
    'transaction-service',
    {
      transactionId: TRANSACTION,
      accountId: SOURCE,
      amount: AMOUNT,
      triggeredBy: 'PAYMENT_RETRIES_EXHAUSTED',
    },
  ],
  [
    'account.debit.compensated.v1',
    'account-service',
    {
      transactionId: TRANSACTION,
      accountId: SOURCE,
      amount: AMOUNT,
      balanceAfter: { amountMinor: 1_000_00, currency: 'GTQ' },
      compensatedAt: '2026-08-19T14:32:39.600Z',
    },
  ],
  [
    'transaction.compensated.v1',
    'transaction-service',
    {
      transactionId: TRANSACTION,
      customerId: CUSTOMER,
      status: 'COMPENSATED',
      reason: 'PAYMENT_RETRIES_EXHAUSTED',
      compensatedAt: '2026-08-19T14:32:39.700Z',
    },
  ],
]);

await mkdir(outputDir, { recursive: true });

for (const [name, messages] of [
  ['happy-path', happyPath],
  ['rejected', rejected],
  ['compensated', compensated],
]) {
  await writeFile(join(outputDir, `${name}.json`), `${JSON.stringify(messages, null, 2)}\n`);
  console.log(`${name}: ${String(messages.length)} messages`);
}
