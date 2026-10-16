import { randomUUID } from 'node:crypto';

import { createEnvelope } from '@bank/contracts';
import { Pool } from 'pg';

import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresInterbankRepository } from '../src/infrastructure/persistence/postgres-interbank.repository';

const URL = process.env.DATABASE_URL;
const suite = URL === undefined ? describe.skip : describe;

suite('interbank deposit persistence', () => {
  let pool: Pool;
  let repository: PostgresInterbankRepository;
  const now = new Date('2026-10-12T12:00:00.000Z');

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    await migrate(pool);
    repository = new PostgresInterbankRepository(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE interbank_deposits, interbank_conflicts');
  });
  afterAll(async () => {
    await pool.end();
  });

  function incoming(depositId = randomUUID()) {
    return createEnvelope(
      {
        depositId,
        interbankTransferId: 'partner-123',
        idempotencyKey: 'partner-123',
        originBankCode: 'BANK99',
        destinationBankCode: 'BANK02',
        accountId: randomUUID(),
        amount: { amountMinor: 12500, currency: 'GTQ' },
        partnerTimestamp: '2026-10-12T11:59:58.000Z',
        requestedAt: now.toISOString(),
      },
      { messageType: 'payment.interbank.receive.v1', producer: 'gateway', identity: null },
    );
  }

  it('deduplicates a partner transfer and advances one locked row to a retriable callback', async () => {
    const origin = incoming();
    const open = { origin, stage: 'ELIGIBILITY' as const, reason: null, result: null, now };
    expect((await repository.open(open)).kind).toBe('CREATED');
    expect((await repository.open(open)).kind).toBe('DUPLICATE');
    const duplicate = { ...incoming(), payload: { ...origin.payload, depositId: randomUUID() } };
    expect((await repository.open({ ...open, origin: duplicate })).kind).toBe('DUPLICATE');
    const conflict = {
      ...incoming(),
      payload: {
        ...origin.payload,
        depositId: randomUUID(),
        amount: { amountMinor: 20000, currency: 'GTQ' },
      },
    };
    expect((await repository.open({ ...open, origin: conflict })).kind).toBe('CONFLICT');

    expect((await repository.claimActions(now, 20)).map((d) => d.stage)).toEqual(['ELIGIBILITY']);
    expect(
      await repository.advance({
        depositId: origin.payload.depositId,
        from: 'ELIGIBILITY',
        to: 'CREDIT',
        reason: null,
        result: null,
        now,
      }),
    ).toBe(true);
    expect((await repository.claimActions(now, 20)).map((d) => d.stage)).toEqual(['CREDIT']);

    const result = createEnvelope(
      { depositId: origin.payload.depositId, decidedAt: now.toISOString() },
      { messageType: 'payment.interbank.accepted.v1', producer: 'payment-service', identity: null },
    );
    expect(
      await repository.advance({
        depositId: origin.payload.depositId,
        from: 'CREDIT',
        to: 'ACCEPTED',
        reason: null,
        result,
        now,
      }),
    ).toBe(true);
    expect(
      await repository.advance({
        depositId: origin.payload.depositId,
        from: 'CREDIT',
        to: 'ACCEPTED',
        reason: null,
        result,
        now,
      }),
    ).toBe(false);
    const sent: string[] = [];
    expect(
      await repository.publishResults(async (event) => {
        sent.push(event.messageId);
      }, 20),
    ).toBe(1);
    expect(
      await repository.publishResults(async (event) => {
        sent.push(event.messageId);
      }, 20),
    ).toBe(0);
    expect(sent).toEqual([result.messageId]);

    expect((await repository.claimCallbacks(now, 20)).map((d) => d.stage)).toEqual(['ACCEPTED']);
    expect(await repository.claimCallbacks(now, 20)).toHaveLength(0);
    expect(await repository.claimCallbacks(new Date(now.getTime() + 2_000), 20)).toHaveLength(1);
    await repository.markCallbackDelivered(origin.payload.depositId, now);
    expect(await repository.claimCallbacks(new Date(now.getTime() + 60_000), 20)).toHaveLength(0);
    await repository.replayCallback(origin.payload.depositId, now);
    expect(await repository.claimCallbacks(now, 20)).toHaveLength(1);
  });

  /**
   * Lo que T-56 cambió en el esquema, comprobado contra PostgreSQL de verdad.
   *
   * Las dos cosas sólo se pueden probar aquí: un tipo de columna que se
   * ensancha se demuestra escribiendo el valor que antes no cabía, y un
   * `ALTER ... USING` se demuestra corriéndolo. Un doble habría aceptado
   * cualquier cadena desde el principio.
   */
  it('guarda el sello del banco pareja aparte del nuestro', async () => {
    const origin = incoming();

    expect(
      (
        await repository.open({
          origin,
          stage: 'ELIGIBILITY' as const,
          reason: null,
          result: null,
          now,
        })
      ).kind,
    ).toBe('CREATED');

    const fila = await pool.query<{ partner_timestamp: Date; created_at: Date }>(
      'SELECT partner_timestamp, created_at FROM interbank_deposits WHERE deposit_id = $1',
      [origin.payload.depositId],
    );

    // Los dos, y son dos cosas distintas: `partner_timestamp` es el sello que
    // mandó el otro banco, y `created_at` lo pone la base al insertar. Con uno
    // solo no se puede distinguir un reloj desfasado de un depósito que tardó
    // en llegar, y los dos se arreglan distinto.
    expect(fila.rows[0]?.partner_timestamp.toISOString()).toBe('2026-10-12T11:59:58.000Z');
    expect(fila.rows[0]?.created_at.toISOString()).not.toBe(
      fila.rows[0]?.partner_timestamp.toISOString(),
    );
  });

  it('acepta una referencia de cuenta que no es un UUID, que es lo que la columna UUID impedía', async () => {
    const origin = incoming();
    // Lo que manda un banco de verdad. Antes de la migración 011 esto no era un
    // rechazo de negocio: era un error de tipo de PostgreSQL.
    const conNumero = { ...origin, payload: { ...origin.payload, accountId: '001-2345-6' } };

    expect(
      (
        await repository.open({
          origin: conNumero,
          stage: 'REJECTED' as const,
          reason: 'ACCOUNT_NOT_FOUND',
          result: createEnvelope(
            {
              depositId: origin.payload.depositId,
              reason: 'ACCOUNT_NOT_FOUND',
              decidedAt: now.toISOString(),
            },
            {
              messageType: 'payment.interbank.rejected.v1',
              producer: 'payment-service',
              identity: null,
            },
          ),
          now,
        })
      ).kind,
    ).toBe('CREATED');

    // Y queda con su callback pendiente: el otro banco se entera del motivo.
    expect((await repository.claimCallbacks(now, 20)).map((d) => d.stage)).toEqual(['REJECTED']);
  });

  it('persists a conflicting receipt and retries its rejection callback', async () => {
    const origin = incoming();
    const result = createEnvelope(
      {
        depositId: origin.payload.depositId,
        reason: 'IDEMPOTENCY_CONFLICT',
        decidedAt: now.toISOString(),
      },
      { messageType: 'payment.interbank.rejected.v1', producer: 'payment-service', identity: null },
    );
    expect(await repository.recordConflict(origin, result, now)).toBe(true);
    expect(await repository.recordConflict(origin, result, now)).toBe(false);
    const sent: string[] = [];
    expect(
      await repository.publishConflictResults(async (event) => {
        sent.push(event.messageId);
      }, 20),
    ).toBe(1);
    expect(sent).toEqual([result.messageId]);
    const claimed = await repository.claimConflictCallbacks(now, 20);
    expect(claimed).toMatchObject([
      {
        messageId: origin.messageId,
        deposit: { stage: 'REJECTED', reason: 'IDEMPOTENCY_CONFLICT' },
      },
    ]);
    expect(await repository.claimConflictCallbacks(now, 20)).toHaveLength(0);
    await repository.markConflictCallbackDelivered(origin.messageId, now);
    expect(
      await repository.claimConflictCallbacks(new Date(now.getTime() + 60_000), 20),
    ).toHaveLength(0);
  });
});
