import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createEnvelope, v1ExpiresAt, v1TransferResult } from '@bank/contracts';
import type { MessageEnvelope, V1TransferRequest } from '@bank/contracts';
import { Pool } from 'pg';

import { InterbankUseCase } from '../src/application/interbank.use-case';
import type {
  InterbankMessenger,
  InterbankTelemetry,
} from '../src/application/interbank.ports';
import { InterbankV1UseCase } from '../src/application/interbank-v1.use-case';
import { HttpPartnerCallback } from '../src/infrastructure/http/partner-callback';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresInterbankRepository } from '../src/infrastructure/persistence/postgres-interbank.repository';
import { PostgresInterbankV1Repository } from '../src/infrastructure/persistence/postgres-interbank-v1.repository';

/**
 * Un depósito del contrato oficial **llega a ACCEPTED** y su callback sale en
 * formato v1, contra PostgreSQL de verdad (T-60, B3).
 *
 * Es el recorrido que la evidencia de T-56 no mostraba (sólo `PROCESSING` y
 * `CANCELLED`): Gateway → Payment → Account (el crédito, doblado aquí por sus
 * mensajes) → callback al banco pareja, que aquí es un servidor HTTP de verdad
 * y valida lo que recibe contra el esquema estricto del contrato.
 *
 * Tres defectos que sólo esta prueba puede ver, porque necesitan la fila tal
 * como la deja el repositorio del contrato y el barrido tal como la lee el otro:
 * el barrido leía `origin.payload.accountId` de un sobre que no era un sobre; un
 * marcador `'{}'` envenenaba la publicación de resultados para siempre; y el
 * callback se mandaba a una URL fija con el cuerpo provisional.
 */

const URL = process.env.DATABASE_URL;
const suite = URL === undefined ? describe.skip : describe;

const AHORA = new Date('2026-10-20T15:00:00.000Z');
const CUENTA = '02-000000052';
const CUENTA_ID = 'b0000000-0000-4000-8000-000000000003';
const API_KEY = 'llave-saliente-de-prueba-0123456789abcdef';

interface Recibido {
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

suite('un depósito del contrato oficial, de punta a punta en este servicio', () => {
  let pool: Pool;
  let v1Repo: PostgresInterbankV1Repository;
  let repo: PostgresInterbankRepository;
  let servidor: Server;
  let base: string;
  let reloj = AHORA;
  let respuestaDelBanco = 200;
  const recibidos: Recibido[] = [];
  const comandos: { messageType: string; payload: Record<string, unknown> }[] = [];
  const publicados: MessageEnvelope<unknown>[] = [];
  const fallos: { step: string; error: string }[] = [];

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
    publishStored: async (envelope) => {
      publicados.push(envelope);
    },
  };

  const telemetry: InterbankTelemetry = {
    stateChanged: () => undefined,
    callbackAttempt: () => undefined,
    illegalTransition: () => undefined,
    sweepFailed: (f) => {
      fallos.push({ step: f.step, error: f.error });
    },
  };

  beforeAll(async () => {
    servidor = createServer((request, response) => {
      const trozos: Buffer[] = [];
      request.on('data', (t: Buffer) => trozos.push(t));
      request.on('end', () => {
        recibidos.push({
          path: request.url ?? '',
          headers: request.headers,
          body: JSON.parse(Buffer.concat(trozos).toString('utf8') || 'null'),
        });
        response.statusCode = respuestaDelBanco;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ received: true }));
      });
    });
    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}/interbank/v1`;

    pool = new Pool({ connectionString: URL });
    await migrate(pool);
    v1Repo = new PostgresInterbankV1Repository(pool);
    repo = new PostgresInterbankRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE interbank_deposits, interbank_conflicts, interbank_reversals');
    reloj = AHORA;
    respuestaDelBanco = 200;
    recibidos.length = 0;
    comandos.length = 0;
    publicados.length = 0;
    fallos.length = 0;
  });

  afterAll(async () => {
    await pool.end();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  });

  function transferencia(overrides: Partial<V1TransferRequest> = {}): V1TransferRequest {
    return {
      interbankTransferId: randomUUID(),
      originBankCode: 'BANK99',
      destinationBankCode: 'BANK02',
      originAccount: '99-000000123',
      destinationAccount: CUENTA,
      amount: '150.00',
      currency: 'GTQ',
      createdAt: AHORA.toISOString(),
      expiresAt: v1ExpiresAt(AHORA).toISOString(),
      ...overrides,
    };
  }

  function nucleo(): InterbankUseCase {
    return new InterbankUseCase({
      repository: repo,
      messenger,
      callback: new HttpPartnerCallback(base, API_KEY, 'BANK02', 'BANK99'),
      bankCode: 'BANK02',
      partnerBankCode: 'BANK99',
      maxAmountMinor: 1_000_000,
      clock: { now: () => reloj },
      telemetry,
      trace: { continue: async (_tp, _span, _corr, work) => await work() },
    });
  }

  function contrato(): InterbankV1UseCase {
    return new InterbankV1UseCase({
      repository: v1Repo,
      messenger,
      reply: async () => undefined,
      bankCode: 'BANK02',
      clock: () => reloj,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
  }

  function desdeGateway(transfer: V1TransferRequest): MessageEnvelope<unknown> {
    return createEnvelope(
      { transfer, callerBankCode: 'BANK99', receivedAt: AHORA.toISOString() },
      {
        messageType: 'payment.interbank.v1.transfer.query.v1',
        producer: 'gateway',
        identity: null,
      },
    );
  }

  async function admitir(transfer: V1TransferRequest): Promise<string> {
    await contrato().transfer(
      { transfer, callerBankCode: 'BANK99', receivedAt: AHORA.toISOString() },
      desdeGateway(transfer),
    );
    const { rows } = await pool.query<{ deposit_id: string }>(
      'SELECT deposit_id FROM interbank_deposits WHERE external_transfer_id = $1',
      [transfer.interbankTransferId],
    );

    return rows[0]!.deposit_id;
  }

  const etapa = async (depositId: string): Promise<string | undefined> =>
    (
      await pool.query<{ stage: string }>(
        'SELECT stage FROM interbank_deposits WHERE deposit_id = $1',
        [depositId],
      )
    ).rows[0]?.stage;

  const respuestaDeAccount = (): MessageEnvelope<unknown> =>
    createEnvelope({}, { messageType: 'account.interbank.credited.v1', producer: 'account-service', identity: null });

  it('llega a ACCEPTED: elegibilidad por número de cuenta, crédito, resultado y callback v1', async () => {
    const transfer = transferencia();
    const depositId = await admitir(transfer);
    const core = nucleo();

    // 1. El barrido pregunta a Account por el NÚMERO de cuenta, no por un UUID.
    await core.sweep();
    expect(fallos).toEqual([]);
    expect(comandos).toHaveLength(1);
    expect(comandos[0]).toMatchObject({
      messageType: 'account.interbank.eligibility.query.v1',
      payload: { depositId, accountNumber: CUENTA },
    });
    expect(comandos[0]?.payload).not.toHaveProperty('accountId');

    // 2. Account contesta que la cuenta existe y está activa.
    await core.eligibility(respuestaDeAccount(), {
      depositId,
      accountId: CUENTA_ID,
      accountNumber: CUENTA,
      eligible: true,
      reason: null,
    });
    expect(await etapa(depositId)).toBe('CREDIT');

    // 3. El barrido ordena el crédito, con el monto en centavos y la cuenta por número.
    reloj = new Date(reloj.getTime() + 6_000);
    await core.sweep();
    const credito = comandos.find((c) => c.messageType === 'account.interbank.credit.requested.v1');
    expect(credito?.payload).toMatchObject({
      depositId,
      accountNumber: CUENTA,
      amount: { amountMinor: 15_000, currency: 'GTQ' },
    });

    // 4. Account acredita.
    await core.credited(respuestaDeAccount(), {
      depositId,
      accountId: CUENTA_ID,
      accountNumber: CUENTA,
      creditedAt: reloj.toISOString(),
    });
    expect(await etapa(depositId)).toBe('ACCEPTED');

    // 5. El resultado sale a la auditoría y el callback sale al banco pareja, en v1.
    await core.sweep();
    expect(publicados.map((e) => e.messageType)).toContain('payment.interbank.accepted.v1');
    expect(recibidos).toHaveLength(1);
    const callback = recibidos[0]!;
    expect(callback.path).toBe(`/interbank/v1/transfers/${transfer.interbankTransferId}/result`);
    expect(callback.headers['x-api-key']).toBe(API_KEY);
    expect(callback.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
    expect(callback.headers.authorization).toBeUndefined();
    // El cuerpo cumple el esquema estricto del curso: `additionalProperties: false`.
    expect(v1TransferResult.safeParse(callback.body).success).toBe(true);
    expect(callback.body).toMatchObject({
      interbankTransferId: transfer.interbankTransferId,
      destinationBankCode: 'BANK02',
      status: 'ACCEPTED',
    });

    const fila = await pool.query<{ callback_delivered_at: Date | null }>(
      'SELECT callback_delivered_at FROM interbank_deposits WHERE deposit_id = $1',
      [depositId],
    );
    expect(fila.rows[0]?.callback_delivered_at).not.toBeNull();

    // Y es idempotente: otra vuelta no vuelve a acreditar ni a llamar.
    await core.sweep();
    expect(recibidos).toHaveLength(1);
  });

  it('un rechazo de Account se cuenta por callback con su motivo del contrato', async () => {
    const transfer = transferencia({ destinationAccount: '02-999999999' });
    const depositId = await admitir(transfer);
    const core = nucleo();

    await core.sweep();
    await core.eligibility(respuestaDeAccount(), {
      depositId,
      accountNumber: '02-999999999',
      eligible: false,
      reason: 'ACCOUNT_NOT_FOUND',
    });
    await core.sweep();

    expect(await etapa(depositId)).toBe('REJECTED');
    expect(recibidos[0]?.body).toMatchObject({
      status: 'REJECTED',
      reasonCode: 'ACCOUNT_NOT_FOUND',
    });
    expect(v1TransferResult.safeParse(recibidos[0]?.body).success).toBe(true);
    // Nunca se ordenó un crédito.
    expect(comandos.map((c) => c.messageType)).not.toContain(
      'account.interbank.credit.requested.v1',
    );
  });

  it('un banco destino equivocado se rechaza al entrar con PROCESSING_ERROR (B7)', async () => {
    const transfer = transferencia({ destinationBankCode: 'BANK07' });
    const depositId = await admitir(transfer);

    expect(await etapa(depositId)).toBe('REJECTED');

    await nucleo().sweep();

    expect(comandos).toEqual([]);
    expect(recibidos[0]?.body).toMatchObject({ status: 'REJECTED', reasonCode: 'PROCESSING_ERROR' });
    expect(publicados.map((e) => e.messageType)).toContain('payment.interbank.rejected.v1');
  });

  it('un callback que el emisor no acepta se reintenta con espera creciente, sin duplicar el crédito', async () => {
    const transfer = transferencia();
    const depositId = await admitir(transfer);
    const core = nucleo();
    await core.sweep();
    await core.eligibility(respuestaDeAccount(), {
      depositId,
      accountId: CUENTA_ID,
      accountNumber: CUENTA,
      eligible: true,
      reason: null,
    });
    reloj = new Date(reloj.getTime() + 6_000);
    await core.sweep();
    await core.credited(respuestaDeAccount(), {
      depositId,
      accountId: CUENTA_ID,
      accountNumber: CUENTA,
      creditedAt: reloj.toISOString(),
    });

    respuestaDelBanco = 503;
    await core.sweep();
    expect(recibidos).toHaveLength(1);

    // Dentro de la espera (2 s, luego 4 s…) no reintenta.
    reloj = new Date(reloj.getTime() + 1_000);
    await core.sweep();
    expect(recibidos).toHaveLength(1);

    respuestaDelBanco = 200;
    reloj = new Date(reloj.getTime() + 3_000);
    await core.sweep();
    expect(recibidos).toHaveLength(2);
    // El crédito se ordenó UNA vez.
    expect(
      comandos.filter((c) => c.messageType === 'account.interbank.credit.requested.v1'),
    ).toHaveLength(2 - 1);
  });

  it('pasadas 24 horas el callback se abandona y se registra', async () => {
    const transfer = transferencia({ destinationBankCode: 'BANK07' });
    await admitir(transfer);
    const core = nucleo();
    respuestaDelBanco = 503;
    await core.sweep();

    reloj = new Date(reloj.getTime() + 25 * 3_600_000);
    await core.sweep();
    const antes = recibidos.length;
    reloj = new Date(reloj.getTime() + 3_600_000);
    await core.sweep();

    expect(fallos.some((f) => f.step === 'callbackAbandoned')).toBe(true);
    expect(recibidos.length).toBe(antes);
  });

  describe('un depósito malo no detiene el barrido (B3)', () => {
    it('una fila del contrato anterior a T-60 no impide atender a las demás', async () => {
      // La forma en que el repositorio las guardaba: {transfer, callerBankCode}.
      const viejo = transferencia();
      await pool.query(
        `INSERT INTO interbank_deposits
           (deposit_id, origin_bank_code, external_transfer_id, idempotency_key,
            destination_account_id, amount_minor, currency, correlation_id,
            origin_envelope, stage, next_action_at, partner_expires_at, created_at)
         VALUES ($1,'BANK99',$2,$2,$3,15000,'GTQ',$4,$5::jsonb,'ELIGIBILITY',$6,$7,$6)`,
        [
          randomUUID(),
          viejo.interbankTransferId,
          CUENTA,
          randomUUID(),
          JSON.stringify({ transfer: viejo, callerBankCode: 'BANK99' }),
          AHORA,
          v1ExpiresAt(AHORA),
        ],
      );
      const bueno = transferencia();
      const buenoId = await admitir(bueno);

      await nucleo().sweep();

      expect(fallos).toEqual([]);
      // Las dos preguntaron a Account, y la vieja con un sobre fabricado.
      expect(comandos).toHaveLength(2);
      expect(comandos.map((c) => c.payload.depositId)).toContain(buenoId);
      expect(comandos.every((c) => c.payload.accountNumber === CUENTA)).toBe(true);
    });

    it('un marcador "{}" sin publicar no bloquea los resultados de los demás', async () => {
      // Lo que el contrato dejaba al cancelar o vencer: un resultado que no es un sobre.
      await pool.query(
        `INSERT INTO interbank_deposits
           (deposit_id, origin_bank_code, external_transfer_id, idempotency_key,
            destination_account_id, amount_minor, currency, correlation_id, origin_envelope,
            stage, rejection_reason, decided_at, result_envelope)
         VALUES ($1,'BANK99',$2,$2,'(x)',1,'GTQ',$3,'{}'::jsonb,'CANCELLED','CANCELLED',$4,'{}'::jsonb)`,
        [randomUUID(), randomUUID(), randomUUID(), AHORA],
      );
      await admitir(transferencia({ destinationBankCode: 'BANK07' }));

      await nucleo().sweep();

      expect(fallos).toEqual([]);
      expect(publicados.map((e) => e.messageType)).toEqual(['payment.interbank.rejected.v1']);
    });
  });

  describe('no hay doble crédito (B4)', () => {
    async function enCredito(core: InterbankUseCase, transfer: V1TransferRequest): Promise<string> {
      const depositId = await admitir(transfer);
      await core.sweep();
      await core.eligibility(respuestaDeAccount(), {
        depositId,
        accountId: CUENTA_ID,
        accountNumber: CUENTA,
        eligible: true,
        reason: null,
      });
      expect(await etapa(depositId)).toBe('CREDIT');

      return depositId;
    }

    it('con el crédito ordenado, la cancelación del emisor NO cancela', async () => {
      const transfer = transferencia();
      const core = nucleo();
      const depositId = await enCredito(core, transfer);
      const respuestas: unknown[] = [];
      const v1 = new InterbankV1UseCase({
        repository: v1Repo,
        messenger,
        reply: async (_tipo, payload) => {
          respuestas.push(payload);
        },
        bankCode: 'BANK02',
        clock: () => reloj,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });

      await v1.cancel({
        interbankTransferId: transfer.interbankTransferId,
        callerBankCode: 'BANK99',
        reason: 'TIMEOUT',
        requestedAt: reloj.toISOString(),
      });

      expect(respuestas[0]).toMatchObject({ result: 'IN_PROGRESS' });
      expect(await etapa(depositId)).toBe('CREDIT');

      // Account acredita después: el cliente queda acreditado Y el emisor lo sabe.
      await core.credited(respuestaDeAccount(), {
        depositId,
        accountId: CUENTA_ID,
        accountNumber: CUENTA,
        creditedAt: reloj.toISOString(),
      });
      expect(await etapa(depositId)).toBe('ACCEPTED');
    });

    it('con el crédito ordenado, el vencimiento NO rechaza: se espera el veredicto de Account', async () => {
      const transfer = transferencia();
      const core = nucleo();
      const depositId = await enCredito(core, transfer);

      reloj = new Date(reloj.getTime() + 181_000);
      const cerrados = await contrato().sweepExpired();

      expect(cerrados).toBe(0);
      expect(await etapa(depositId)).toBe('CREDIT');

      await core.credited(respuestaDeAccount(), {
        depositId,
        accountId: CUENTA_ID,
        accountNumber: CUENTA,
        creditedAt: reloj.toISOString(),
      });
      expect(await etapa(depositId)).toBe('ACCEPTED');
    });

    it('sin orden de crédito, el vencimiento sí cierra con EXPIRED y lo cuenta por callback', async () => {
      const transfer = transferencia();
      const depositId = await admitir(transfer);

      reloj = new Date(reloj.getTime() + 181_000);
      expect(await contrato().sweepExpired()).toBe(1);
      expect(await etapa(depositId)).toBe('REJECTED');

      await nucleo().sweep();
      expect(recibidos[0]?.body).toMatchObject({ status: 'REJECTED', reasonCode: 'EXPIRED' });
      expect(v1TransferResult.safeParse(recibidos[0]?.body).success).toBe(true);
    });

    it('la elegibilidad contestada tarde no ordena el crédito: se rechaza con EXPIRED', async () => {
      const transfer = transferencia();
      const depositId = await admitir(transfer);
      const core = nucleo();
      await core.sweep();

      reloj = new Date(reloj.getTime() + 181_000);
      await core.eligibility(respuestaDeAccount(), {
        depositId,
        accountId: CUENTA_ID,
        accountNumber: CUENTA,
        eligible: true,
        reason: null,
      });

      expect(await etapa(depositId)).toBe('REJECTED');
      const { rows } = await pool.query<{ rejection_reason: string }>(
        'SELECT rejection_reason FROM interbank_deposits WHERE deposit_id = $1',
        [depositId],
      );
      expect(rows[0]?.rejection_reason).toBe('EXPIRED');
    });

    it('una cancelación antes de ordenar el crédito sí cancela, y un CREDITED posterior no lo reabre', async () => {
      const transfer = transferencia();
      const depositId = await admitir(transfer);
      const respuestas: unknown[] = [];
      const v1 = new InterbankV1UseCase({
        repository: v1Repo,
        messenger,
        reply: async (_tipo, payload) => {
          respuestas.push(payload);
        },
        bankCode: 'BANK02',
        clock: () => reloj,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });

      await v1.cancel({
        interbankTransferId: transfer.interbankTransferId,
        callerBankCode: 'BANK99',
        reason: 'TIMEOUT',
        requestedAt: reloj.toISOString(),
      });
      expect(respuestas[0]).toMatchObject({ result: 'CANCELLED' });
      expect(await etapa(depositId)).toBe('CANCELLED');

      const core = nucleo();
      await core.credited(respuestaDeAccount(), {
        depositId,
        accountId: CUENTA_ID,
        accountNumber: CUENTA,
        creditedAt: reloj.toISOString(),
      });
      expect(await etapa(depositId)).toBe('CANCELLED');
    });
  });
});
