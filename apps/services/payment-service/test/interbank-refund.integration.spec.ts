import { randomUUID } from 'node:crypto';

import {
  INTERBANK_SETTLEMENT_ACCOUNT_ID,
  createEnvelope,
  v1ExpiresAt,
} from '@bank/contracts';
import type { MessageEnvelope, V1TransferRequest } from '@bank/contracts';
import { Pool } from 'pg';

import { InterbankUseCase } from '../src/application/interbank.use-case';
import type { InterbankMessenger, PartnerCallback } from '../src/application/interbank.ports';
import { InterbankV1UseCase } from '../src/application/interbank-v1.use-case';
import type { InterbankSendReversalState } from '../src/application/interbank-send.ports';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresInterbankRepository } from '../src/infrastructure/persistence/postgres-interbank.repository';
import { PostgresInterbankSendRepository } from '../src/infrastructure/persistence/postgres-interbank-send.repository';
import { PostgresInterbankV1Repository } from '../src/infrastructure/persistence/postgres-interbank-v1.repository';

/**
 * El reembolso de un reverso no llega al cliente (QA 13c), contra PostgreSQL de
 * verdad.
 *
 * El defecto, visto en el clúster: el banco pareja acreditó tarde, se le pidió
 * el reverso, y su depósito de devolución —un `POST /transfers` normal hacia la
 * cuenta del cliente— se acreditó como cualquier depósito. El cliente, que ya
 * estaba compensado, recibía el dinero dos veces (490 000 → 505 000).
 *
 * Aquí el banco pareja y Account son dobles que **registran** lo que se les
 * ordena; lo que se afirma es a quién se le ordena acreditar: la cuenta de
 * liquidación, nunca la del cliente.
 */

const URL = process.env.DATABASE_URL;
const suite = URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

const AHORA = new Date('2026-10-20T15:00:00.000Z');
const CUENTA_CLIENTE = '02-000000361';
const CLIENTE_ID = 'b0000000-0000-4000-8000-000000000003';
const LIQUIDACION = INTERBANK_SETTLEMENT_ACCOUNT_ID;

suite('el reembolso de un reverso', () => {
  let pool: Pool;
  let sends: PostgresInterbankSendRepository;
  let v1Repo: PostgresInterbankV1Repository;
  let repo: PostgresInterbankRepository;
  let reloj = AHORA;
  const comandos: { messageType: string; payload: Record<string, unknown> }[] = [];
  const callbacks: string[] = [];
  const alertas: Record<string, unknown>[] = [];
  const trazas: string[] = [];

  const messenger: InterbankMessenger = {
    command: async (_cause, messageType, payload) => {
      comandos.push({ messageType, payload: payload as Record<string, unknown> });
    },
    result: (cause, messageType, payload) =>
      createEnvelope(payload, {
        messageType,
        producer: 'payment-service',
        identity: null,
        correlationId: cause.correlationId,
      }),
    publishStored: async () => undefined,
  };
  const callback: PartnerCallback = {
    deliver: async (deposit) => {
      callbacks.push(`${deposit.externalTransferId}:${deposit.stage}:${deposit.reason ?? ''}`);
    },
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    await migrate(pool);
    sends = new PostgresInterbankSendRepository(pool);
    v1Repo = new PostgresInterbankV1Repository(pool);
    repo = new PostgresInterbankRepository(pool);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE interbank_sends, interbank_send_history, interbank_deposits, interbank_conflicts, interbank_reversals, outbox_messages',
    );
    reloj = AHORA;
    comandos.length = 0;
    callbacks.length = 0;
    alertas.length = 0;
    trazas.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  const log = {
    info: () => undefined,
    warn: () => undefined,
    error: (_mensaje: string, campos: Record<string, unknown>) => {
      alertas.push(campos);
    },
  };

  function contrato(): InterbankV1UseCase {
    return new InterbankV1UseCase({
      repository: v1Repo,
      messenger,
      reply: async () => undefined,
      bankCode: 'BANK02',
      clock: () => reloj,
      trace: {
        continue: async (traceparent, span, _correlacion, work) => {
          trazas.push(`${span}:${String(traceparent)}`);

          return await work();
        },
      },
      log,
    });
  }

  function nucleo(): InterbankUseCase {
    return new InterbankUseCase({
      repository: repo,
      messenger,
      callback,
      bankCode: 'BANK02',
      partnerBankCode: 'BANK99',
      maxAmountMinor: 1_000_000,
      clock: { now: () => reloj },
      telemetry: {
        stateChanged: () => undefined,
        callbackAttempt: () => undefined,
        illegalTransition: () => undefined,
        sweepFailed: () => undefined,
      },
      trace: { continue: async (_tp, _span, _corr, work) => await work() },
    });
  }

  /** Un envío nuestro ya liberado, con su reverso en el estado dado (el cliente ya fue compensado). */
  async function envioLiberado(
    reverso: { state: InterbankSendReversalState; refundTransferId?: string | null },
    overrides: { amountMinor?: number } = {},
  ): Promise<{ sendId: string; reversalId: string }> {
    const sendId = randomUUID();
    const reversalId = randomUUID();
    const traza = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    await sends.open({
      send: {
        interbankTransferId: sendId,
        paymentId: randomUUID(),
        transactionId: randomUUID(),
        idempotencyKey: sendId,
        destinationBankCode: 'BANK99',
        destinationAccount: '99-000000123',
        originAccount: CUENTA_CLIENTE,
        customerId: CLIENTE_ID,
        amount: { amountMinor: overrides.amountMinor ?? 15_000, currency: 'GTQ' },
        correlationId: randomUUID(),
        confirmationDueAt: new Date(AHORA.getTime() + 180_000),
        releaseNotBefore: new Date(AHORA.getTime() + 480_000),
        createdAt: AHORA,
        traceContext: traza,
        origin: createEnvelope({}, { messageType: 'payment.requested.v1', producer: 'transaction-service', identity: null }),
      },
      now: AHORA,
    });
    const paso = async (from: 'PENDING' | 'SENT' | 'TIMEOUT', to: 'SENT' | 'TIMEOUT' | 'REJECTED', reason: string | null) =>
      await sends.advance({ interbankTransferId: sendId, from, to, reason, nextAttemptAt: null, now: AHORA });
    await paso('PENDING', 'SENT', null);
    await paso('SENT', 'TIMEOUT', 'CONFIRMATION_TIMEOUT');
    await paso('TIMEOUT', 'REJECTED', 'CANCELLED_AT_PARTNER');
    await sends.requestReversal({ interbankTransferId: sendId, reversalId, now: AHORA });
    if (reverso.state !== 'PENDING') {
      await sends.recordReversalStep({
        interbankTransferId: sendId,
        state: reverso.state,
        refundTransferId: reverso.refundTransferId ?? null,
        message: reverso.state === 'FAILED' ? 'HTTP_404' : null,
        nextAt: reverso.state === 'PROCESSING' ? AHORA : null,
        now: AHORA,
      });
    }

    return { sendId, reversalId };
  }

  const resolverReverso = async (
    sendId: string,
    state: InterbankSendReversalState,
    refundTransferId: string | null = null,
  ): Promise<void> => {
    await sends.recordReversalStep({
      interbankTransferId: sendId,
      state,
      refundTransferId,
      message: state === 'FAILED' ? 'HTTP_404' : null,
      nextAt: state === 'PROCESSING' ? reloj : null,
      now: reloj,
    });
  };

  function reembolso(id: string, overrides: Partial<V1TransferRequest> = {}): V1TransferRequest {
    return {
      interbankTransferId: id,
      originBankCode: 'BANK99',
      destinationBankCode: 'BANK02',
      originAccount: '99-000000123',
      destinationAccount: CUENTA_CLIENTE,
      amount: '150.00',
      currency: 'GTQ',
      createdAt: reloj.toISOString(),
      expiresAt: v1ExpiresAt(reloj).toISOString(),
      ...overrides,
    };
  }

  async function llega(transfer: V1TransferRequest, banco = 'BANK99'): Promise<string> {
    const causa = createEnvelope(
      { transfer, callerBankCode: banco, receivedAt: reloj.toISOString() },
      { messageType: 'payment.interbank.v1.transfer.query.v1', producer: 'gateway', identity: null },
    );
    await contrato().transfer(
      { transfer, callerBankCode: banco, receivedAt: reloj.toISOString() },
      causa,
    );
    const { rows } = await pool.query<{ deposit_id: string }>(
      'SELECT deposit_id FROM interbank_deposits WHERE external_transfer_id = $1 AND origin_bank_code = $2',
      [transfer.interbankTransferId, banco],
    );

    return rows[0]!.deposit_id;
  }

  const etapa = async (depositId: string): Promise<string> =>
    (await pool.query<{ stage: string }>('SELECT stage FROM interbank_deposits WHERE deposit_id=$1', [depositId])).rows[0]!.stage;

  const respuestaDeAccount = (): MessageEnvelope<unknown> =>
    createEnvelope({}, { messageType: 'account.interbank.credited.v1', producer: 'account-service', identity: null });

  /** Lleva el depósito hasta el final como lo haría Account, contra la cuenta que se le pregunte. */
  async function conAccount(depositId: string): Promise<void> {
    const core = nucleo();
    await core.sweep();
    const consulta = comandos.filter((c) => c.payload.depositId === depositId).at(-1);
    const ref = consulta?.payload as { accountId?: string; accountNumber?: string };
    await core.eligibility(respuestaDeAccount(), {
      depositId,
      ...(ref.accountId === undefined ? {} : { accountId: ref.accountId }),
      ...(ref.accountNumber === undefined ? {} : { accountNumber: ref.accountNumber }),
      eligible: true,
      reason: null,
    });
    reloj = new Date(reloj.getTime() + 6_000);
    await core.sweep();
    await core.credited(respuestaDeAccount(), {
      depositId,
      accountId: ref.accountId ?? CLIENTE_ID,
      ...(ref.accountNumber === undefined ? {} : { accountNumber: ref.accountNumber }),
      creditedAt: reloj.toISOString(),
    });
  }

  /** A quién se le ordenó acreditar (accountId o accountNumber), en orden. */
  const creditos = (): string[] =>
    comandos
      .filter((c) => c.messageType === 'account.interbank.credit.requested.v1')
      .map((c) => String(c.payload.accountId ?? c.payload.accountNumber));

  it('el reembolso llega ANTES de que el reverso diga COMPLETED: se retiene y luego va a liquidación', async () => {
    const { sendId, reversalId } = await envioLiberado({ state: 'PROCESSING' });
    const id = randomUUID();

    const depositId = await llega(reembolso(id));

    // Aceptado (el 202 ya se dio) pero retenido: nadie recibe nada todavía.
    expect(await etapa(depositId)).toBe('ELIGIBILITY');
    await nucleo().sweep();
    expect(comandos).toEqual([]);
    // Y se adelantó la consulta del reverso para resolverlo con prisa.
    expect((await sends.find(sendId))!.reversal?.nextAt!.getTime()).toBeLessThanOrEqual(reloj.getTime());
    // Mientras el reverso no termina, la resolución espera.
    expect(await contrato().resolveHeldRefunds()).toBe(0);
    expect(comandos).toEqual([]);

    // El pareja marca COMPLETED con el identificador de este depósito.
    await resolverReverso(sendId, 'COMPLETED', id);
    expect(await contrato().resolveHeldRefunds()).toBe(1);
    await conAccount(depositId);

    expect(creditos()).toEqual([LIQUIDACION]);
    expect(creditos()).not.toContain(CUENTA_CLIENTE);
    expect(await etapa(depositId)).toBe('ACCEPTED');
    // El emisor se entera de que lo aceptamos: el reembolso se cierra en su lado.
    await nucleo().sweep();
    expect(callbacks).toEqual([`${id}:ACCEPTED:`]);
    // El reverso queda liquidado con este depósito.
    const envio = await pool.query<{ refund_inbound_id: string; refund_settled_at: Date }>(
      'SELECT refund_inbound_id, refund_settled_at FROM interbank_sends WHERE interbank_transfer_id=$1',
      [sendId],
    );
    expect(envio.rows[0]?.refund_inbound_id).toBe(id);
    expect(envio.rows[0]?.refund_settled_at).not.toBeNull();
    expect(reversalId).toBeDefined();
    // La traza del depósito se continuó en la resolución.
    expect(trazas.some((t) => t.startsWith('payment.interbank.refund:'))).toBe(true);
  });

  it('el reembolso llega DESPUÉS de que el reverso dijo COMPLETED con su identificador: directo a liquidación', async () => {
    const id = randomUUID();
    const { sendId } = await envioLiberado({ state: 'COMPLETED', refundTransferId: id });

    const depositId = await llega(reembolso(id));
    await conAccount(depositId);

    expect(creditos()).toEqual([LIQUIDACION]);
    expect(await etapa(depositId)).toBe('ACCEPTED');
    expect((await pool.query('SELECT 1 FROM interbank_sends WHERE interbank_transfer_id=$1 AND refund_inbound_id=$2', [sendId, id])).rowCount).toBe(1);
  });

  it('un depósito que NO es el reembolso, mientras el reverso está abierto, acaba acreditándose al cliente', async () => {
    const { sendId } = await envioLiberado({ state: 'PROCESSING' });
    const otro = randomUUID();
    const reembolsoReal = randomUUID();

    const depositId = await llega(reembolso(otro));
    expect(await etapa(depositId)).toBe('ELIGIBILITY');
    expect(comandos).toEqual([]);

    // El pareja dice que su reembolso es OTRO depósito.
    await resolverReverso(sendId, 'COMPLETED', reembolsoReal);
    expect(await contrato().resolveHeldRefunds()).toBe(1);
    await conAccount(depositId);

    expect(creditos()).toEqual([CUENTA_CLIENTE]);
    expect(await etapa(depositId)).toBe('ACCEPTED');
  });

  it('si el reverso FALLÓ, el depósito retenido se acredita normal', async () => {
    const { sendId } = await envioLiberado({ state: 'PROCESSING' });
    const depositId = await llega(reembolso(randomUUID()));

    await resolverReverso(sendId, 'FAILED');
    expect(await contrato().resolveHeldRefunds()).toBe(1);
    await conAccount(depositId);

    expect(creditos()).toEqual([CUENTA_CLIENTE]);
  });

  it('un reembolso reenviado no se acredita dos veces', async () => {
    const id = randomUUID();
    const { sendId } = await envioLiberado({ state: 'PROCESSING' });
    const transfer = reembolso(id);

    const depositId = await llega(transfer);
    const repetidoRetenido = await llega(transfer);
    await resolverReverso(sendId, 'COMPLETED', id);
    await contrato().resolveHeldRefunds();
    await conAccount(depositId);
    // Y otra vez, ya liquidado: el emisor reintenta tras el 202.
    const repetidoLiquidado = await llega(transfer);
    await nucleo().sweep();

    expect(repetidoRetenido).toBe(depositId);
    expect(repetidoLiquidado).toBe(depositId);
    expect(creditos()).toEqual([LIQUIDACION]);
    expect((await pool.query('SELECT 1 FROM interbank_deposits')).rowCount).toBe(1);
  });

  it('si el reverso no se resuelve antes del vencimiento, se rechaza con EXPIRED y no se acredita a nadie', async () => {
    await envioLiberado({ state: 'PROCESSING' });
    const depositId = await llega(reembolso(randomUUID()));

    reloj = new Date(reloj.getTime() + 181_000);
    expect(await contrato().sweepExpired()).toBe(1);
    await nucleo().sweep();

    expect(await etapa(depositId)).toBe('REJECTED');
    expect(comandos).toEqual([]);
    expect(callbacks[0]).toMatch(/:REJECTED:EXPIRED$/);
    expect(alertas.some((a) => a.outcome === 'REFUND_UNRESOLVED_AT_EXPIRY')).toBe(true);
  });

  it('con dos retenidos del mismo monto, sólo el que el pareja nombra va a liquidación', async () => {
    const { sendId } = await envioLiberado({ state: 'PROCESSING' });
    const real = randomUUID();
    const parecido = randomUUID();
    const dReal = await llega(reembolso(real));
    const dParecido = await llega(reembolso(parecido));

    await resolverReverso(sendId, 'COMPLETED', real);
    expect(await contrato().resolveHeldRefunds()).toBe(2);
    await conAccount(dReal);
    await conAccount(dParecido);

    expect(creditos().sort()).toEqual([LIQUIDACION, CUENTA_CLIENTE].sort());
    const destino = async (d: string): Promise<string | null> =>
      (await pool.query<{ credit_account_ref: string | null }>('SELECT credit_account_ref FROM interbank_deposits WHERE deposit_id=$1', [d])).rows[0]!.credit_account_ref;
    expect(await destino(dReal)).toBe(LIQUIDACION);
    expect(await destino(dParecido)).toBeNull();
  });

  it('el reverso COMPLETED sin identificador: prefiere no duplicar y lo registra en ERROR', async () => {
    const { sendId } = await envioLiberado({ state: 'PROCESSING' });
    const id = randomUUID();
    const depositId = await llega(reembolso(id));

    await resolverReverso(sendId, 'COMPLETED', null);
    await contrato().resolveHeldRefunds();
    await conAccount(depositId);

    expect(creditos()).toEqual([LIQUIDACION]);
  });

  describe('lo que NO se retiene', () => {
    it('un depósito de otro banco con el mismo monto y destino', async () => {
      await envioLiberado({ state: 'PROCESSING' });

      const depositId = await llega(reembolso(randomUUID(), { originBankCode: 'BANK07' }), 'BANK07');
      await conAccount(depositId);

      expect(creditos()).toEqual([CUENTA_CLIENTE]);
    });

    it('un depósito de otro monto', async () => {
      await envioLiberado({ state: 'PROCESSING' });

      const depositId = await llega(reembolso(randomUUID(), { amount: '150.01' }));
      await conAccount(depositId);

      expect(creditos()).toEqual([CUENTA_CLIENTE]);
    });

    it('un depósito a otra cuenta', async () => {
      await envioLiberado({ state: 'PROCESSING' });

      const depositId = await llega(reembolso(randomUUID(), { destinationAccount: '02-000000999' }));
      await conAccount(depositId);

      expect(creditos()).toEqual(['02-000000999']);
    });

    it('cualquier depósito cuando no hay ningún reverso abierto', async () => {
      const depositId = await llega(reembolso(randomUUID()));
      await conAccount(depositId);

      expect(creditos()).toEqual([CUENTA_CLIENTE]);
    });

    it('un depósito después de que el reverso ya se liquidó con otro', async () => {
      const real = randomUUID();
      const { sendId } = await envioLiberado({ state: 'PROCESSING' });
      const dReal = await llega(reembolso(real));
      await resolverReverso(sendId, 'COMPLETED', real);
      await contrato().resolveHeldRefunds();
      await conAccount(dReal);
      comandos.length = 0;

      const posterior = await llega(reembolso(randomUUID()));
      await conAccount(posterior);

      expect(creditos()).toEqual([CUENTA_CLIENTE]);
    });
  });
});
