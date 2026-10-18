import { randomUUID } from 'node:crypto';

import { createEnvelope, v1ExpiresAt } from '@bank/contracts';
import type { V1TransferRequest } from '@bank/contracts';
import { Pool } from 'pg';

import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresInterbankV1Repository } from '../src/infrastructure/persistence/postgres-interbank-v1.repository';

/**
 * El contrato oficial contra PostgreSQL de verdad (T-56).
 *
 * Lo que sólo se puede comprobar aquí: que la **idempotencia la decide la
 * restricción única** y no una consulta previa, que el guardia de estado en el
 * `WHERE` hace que dos operaciones simultáneas no ganen las dos, y que
 * `original_transfer_id UNIQUE` impide devolver el mismo dinero dos veces. Un
 * doble habría aceptado todo eso sin discutir.
 */

const URL = process.env.DATABASE_URL;
const suite = URL === undefined ? describe.skip : describe;

suite('el contrato interbancario, en la base', () => {
  let pool: Pool;
  let repository: PostgresInterbankV1Repository;
  const now = new Date('2026-10-20T15:00:00.000Z');
  const BANCO = 'BANK99';

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    await migrate(pool);
    repository = new PostgresInterbankV1Repository(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE interbank_deposits, interbank_conflicts, interbank_reversals');
  });
  afterAll(async () => {
    await pool.end();
  });

  /** Lo que el caso de uso aporta: el id, el sobre del Gateway y la política de admisión. */
  function admitir(input: {
    transfer: V1TransferRequest;
    callerBankCode: string;
    now: Date;
    rejection?: Parameters<PostgresInterbankV1Repository['admit']>[0]['rejection'];
  }) {
    return repository.admit({
      depositId: randomUUID(),
      origin: createEnvelope(
        { transfer: input.transfer, callerBankCode: input.callerBankCode },
        {
          messageType: 'payment.interbank.v1.transfer.query.v1',
          producer: 'gateway',
          identity: null,
        },
      ),
      rejection: null,
      ...input,
    });
  }

  function deposito(overrides: Partial<V1TransferRequest> = {}): V1TransferRequest {
    return {
      interbankTransferId: randomUUID(),
      originBankCode: BANCO,
      destinationBankCode: 'BANK02',
      originAccount: '99-000000123',
      destinationAccount: '02-000000052',
      amount: '150.00',
      currency: 'GTQ',
      createdAt: now.toISOString(),
      expiresAt: v1ExpiresAt(now).toISOString(),
      ...overrides,
    };
  }

  describe('la admisión', () => {
    it('admite uno nuevo y reconoce el mismo otra vez como duplicado', async () => {
      const transfer = deposito();

      const primero = await admitir({ transfer, callerBankCode: BANCO, now });
      const repetido = await admitir({ transfer, callerBankCode: BANCO, now });

      expect(primero.admission).toBe('ACCEPTED_FOR_PROCESSING');
      expect(repetido.admission).toBe('DUPLICATE');
      if (repetido.admission === 'DUPLICATE') {
        // El duplicado trae el estado actual, que es lo que el contrato pide
        // devolver con el 200.
        expect(repetido.row.status).toBe('PROCESSING');
        expect(repetido.row.interbankTransferId).toBe(transfer.interbankTransferId);
      }
    });

    it('da CONFLICT cuando el mismo id trae otro contenido', async () => {
      const transfer = deposito();
      await admitir({ transfer, callerBankCode: BANCO, now });

      for (const distinto of [
        { amount: '999.00' },
        { destinationAccount: '02-000000099' },
        { originAccount: '99-000000999' },
      ]) {
        const resultado = await admitir({
          transfer: { ...transfer, ...distinto },
          callerBankCode: BANCO,
          now,
        });

        expect(resultado.admission).toBe('CONFLICT');
      }
    });

    it('el identificador de un banco no colisiona con el del otro', async () => {
      /*
       * La unicidad es `(origin_bank_code, external_transfer_id)` y no sólo el
       * identificador, y es deliberado: el `interbankTransferId` **lo elige el
       * banco emisor**, así que su espacio de identificadores es suyo. Sin el
       * banco en la clave, dos parejas que eligieran el mismo valor se
       * pisarían, y el segundo depósito se descartaría como duplicado del
       * primero — acreditándole a uno el dinero del otro.
       */
      const transfer = deposito();
      await admitir({ transfer, callerBankCode: BANCO, now });

      const otro = await admitir({ transfer, callerBankCode: 'BANK07', now });

      expect(otro.admission).toBe('ACCEPTED_FOR_PROCESSING');
      // Y cada uno sólo ve el suyo.
      expect(
        (await repository.findForBank(transfer.interbankTransferId, BANCO))?.originBankCode,
      ).toBe(BANCO);
      expect(
        (await repository.findForBank(transfer.interbankTransferId, 'BANK07'))?.originBankCode,
      ).toBe('BANK07');
    });

    it('guarda el monto en centavos, no el texto', async () => {
      const transfer = deposito({ amount: '1.15' });
      await admitir({ transfer, callerBankCode: BANCO, now });

      const { rows } = await pool.query<{ amount_minor: string }>(
        'SELECT amount_minor FROM interbank_deposits WHERE external_transfer_id = $1',
        [transfer.interbankTransferId],
      );

      // 115 y no 114, que es lo que da `Math.round(1.15 * 100)`.
      expect(rows[0]?.amount_minor).toBe('115');
    });
  });

  describe('la identidad de quien pregunta', () => {
    it('no deja ver un depósito a un banco que no participa', async () => {
      const transfer = deposito();
      await admitir({ transfer, callerBankCode: BANCO, now });

      expect(await repository.findForBank(transfer.interbankTransferId, BANCO)).not.toBeNull();
      // «Un banco sólo puede consultar transferencias en las que participa.»
      expect(await repository.findForBank(transfer.interbankTransferId, 'BANK07')).toBeNull();
    });
  });

  describe('la cancelación', () => {
    it('cancela uno sin decidir, y la segunda vez ya no cambia nada', async () => {
      const transfer = deposito();
      await admitir({ transfer, callerBankCode: BANCO, now });

      expect(
        await repository.cancel({ interbankTransferId: transfer.interbankTransferId, now, result: null }),
      ).toBe(true);
      // El guardia del `WHERE`: dos cancelaciones no ganan las dos.
      expect(
        await repository.cancel({ interbankTransferId: transfer.interbankTransferId, now, result: null }),
      ).toBe(false);

      const fila = await repository.findForBank(transfer.interbankTransferId, BANCO);

      expect(fila?.status).toBe('CANCELLED');
      expect(fila?.reasonCode).toBe('CANCELLED');
    });

    it('deja constancia de la cancelación de uno que nunca llegó', async () => {
      // Lo que el contrato pide: «guarda el id y rechaza cualquier llegada
      // posterior del mensaje original».
      const id = randomUUID();

      await repository.admitCancellationOfUnknown({
        interbankTransferId: id,
        callerBankCode: BANCO,
        now,
      });

      const fila = await repository.findForBank(id, BANCO);

      expect(fila?.status).toBe('CANCELLED');

      // Y si el mensaje original llega después, no se admite.
      const tarde = await admitir({
        transfer: deposito({ interbankTransferId: id }),
        callerBankCode: BANCO,
        now,
      });

      expect(tarde.admission).toBe('CONFLICT');
    });
  });

  describe('el vencimiento, que el contrato prohíbe ignorar', () => {
    it('encuentra los vencidos y los cierra con EXPIRED', async () => {
      const transfer = deposito();
      await admitir({ transfer, callerBankCode: BANCO, now });

      const despues = new Date(now.getTime() + 181_000);
      const vencidos = await repository.claimExpired(despues, 20);

      expect(vencidos.map((v) => v.interbankTransferId)).toEqual([transfer.interbankTransferId]);

      expect(
        await repository.expire({
          interbankTransferId: transfer.interbankTransferId,
          now: despues,
          result: null,
        }),
      ).toBe(true);

      const fila = await repository.findForBank(transfer.interbankTransferId, BANCO);

      expect(fila?.status).toBe('REJECTED');
      expect(fila?.reasonCode).toBe('EXPIRED');
      // Y ya no aparece como vencido pendiente.
      expect(await repository.claimExpired(despues, 20)).toHaveLength(0);
    });

    it('no toca uno que todavía está en plazo', async () => {
      const transfer = deposito();
      await admitir({ transfer, callerBankCode: BANCO, now });

      const antes = new Date(now.getTime() + 60_000);

      expect(await repository.claimExpired(antes, 20)).toHaveLength(0);
    });

    it('no vence uno ya cancelado', async () => {
      const transfer = deposito();
      await admitir({ transfer, callerBankCode: BANCO, now });
      await repository.cancel({ interbankTransferId: transfer.interbankTransferId, now, result: null });

      const despues = new Date(now.getTime() + 181_000);

      expect(
        await repository.expire({
          interbankTransferId: transfer.interbankTransferId,
          now: despues,
          result: null,
        }),
      ).toBe(false);
    });
  });

  describe('la conciliación', () => {
    it('cuenta y pagina sólo los del banco que pregunta, en el día UTC', async () => {
      for (let i = 0; i < 3; i += 1) {
        await admitir({ transfer: deposito(), callerBankCode: BANCO, now });
      }
      await admitir({ transfer: deposito(), callerBankCode: 'BANK07', now });

      const pagina = await repository.reconcile({
        callerBankCode: BANCO,
        date: '2026-10-20',
        page: 1,
        pageSize: 2,
      });

      expect(pagina.totalItems).toBe(3);
      expect(pagina.items).toHaveLength(2);

      const segunda = await repository.reconcile({
        callerBankCode: BANCO,
        date: '2026-10-20',
        page: 2,
        pageSize: 2,
      });

      expect(segunda.items).toHaveLength(1);
    });

    it('no devuelve los de otro día', async () => {
      await admitir({ transfer: deposito(), callerBankCode: BANCO, now });

      const otroDia = await repository.reconcile({
        callerBankCode: BANCO,
        date: '2026-10-21',
        page: 1,
        pageSize: 100,
      });

      expect(otroDia.totalItems).toBe(0);
    });
  });

  describe('los reversos', () => {
    it('registra uno y lo encuentra, sólo para el banco que lo pidió', async () => {
      const reversalId = randomUUID();
      const originalTransferId = randomUUID();

      const abierto = await repository.openReversal({
        reversalId,
        originalTransferId,
        requesterBankCode: BANCO,
        amountMinor: 15_000,
        origin: { prueba: true },
        now,
      });

      expect(abierto.created).toBe(true);
      expect(abierto.reversal.status).toBe('PROCESSING');
      expect(await repository.findReversal(reversalId, BANCO)).not.toBeNull();
      expect(await repository.findReversal(reversalId, 'BANK07')).toBeNull();
    });

    it('es idempotente por reversalId', async () => {
      const reversalId = randomUUID();
      const originalTransferId = randomUUID();
      const entrada = {
        reversalId,
        originalTransferId,
        requesterBankCode: BANCO,
        amountMinor: 15_000,
        origin: {},
        now,
      };

      await repository.openReversal(entrada);
      const repetido = await repository.openReversal(entrada);

      expect(repetido.created).toBe(false);
      expect(repetido.reversal.status).toBe('PROCESSING');
    });

    it('rechaza un segundo reverso del mismo depósito: ese dinero ya se devolvió', async () => {
      const originalTransferId = randomUUID();
      await repository.openReversal({
        reversalId: randomUUID(),
        originalTransferId,
        requesterBankCode: BANCO,
        amountMinor: 15_000,
        origin: {},
        now,
      });

      const segundo = await repository.openReversal({
        reversalId: randomUUID(),
        originalTransferId,
        requesterBankCode: BANCO,
        amountMinor: 15_000,
        origin: {},
        now,
      });

      // La restricción `original_transfer_id UNIQUE` es lo que lo impide, no un
      // `if`: devolver el mismo dinero dos veces es la pérdida que §8.3 castiga.
      expect(segundo.created).toBe(false);
      expect(segundo.reversal.status).toBe('FAILED');
      expect(segundo.reversal.reasonMessage).toContain('ya tiene un reverso');
    });
  });
});
