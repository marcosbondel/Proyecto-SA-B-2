import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createEnvelope, v1TransferRequest, v1TransferResult } from '@bank/contracts';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

import type { InterbankDeposit } from '../src/application/interbank.ports';
import type { InterbankSend } from '../src/application/interbank-send.ports';
import {
  buildCancelRequest,
  buildReversalRequest,
  buildTransferRequest,
  buildTransferResult,
} from '../src/infrastructure/http/partner-bodies';
import { deterministicUuid } from '../src/application/deterministic-uuid';

/**
 * Lo que este banco le manda al banco pareja cumple el contrato OFICIAL del
 * curso (T-60, B1).
 *
 * El oráculo no es nuestro esquema Zod sino el propio OpenAPI —el archivo que
 * «los grupos no deben modificar»—, validado con Ajv como hace el repositorio
 * del acuerdo (`scripts/validate-examples.mjs`). Un cuerpo que pasa nuestro Zod
 * y falla aquí es exactamente el defecto que existía: el emisor mandaba el
 * formato provisional, `additionalProperties: false` lo rechazaba, y ningún
 * banco que validara el esquema nos habría aceptado un solo envío.
 *
 * Los ejemplos de `fixtures/interbank-contract-examples/` son una copia de los
 * del repositorio del acuerdo (`marcosbondel/bank-interbank-contract`): los
 * válidos tienen que pasar y los de `invalid/` tienen que fallar, que es la
 * mitad que importa — un esquema que acepta cualquier cosa pasa la primera
 * mitad sin esfuerzo.
 */

const RAIZ = join(__dirname, '..', '..', '..', '..');
const CONTRATO = join(RAIZ, 'docs', 'references', 'interbank-contract-v1.openapi.yaml');
const EJEMPLOS = join(__dirname, 'fixtures', 'interbank-contract-examples');

const contrato = parse(readFileSync(CONTRATO, 'utf8')) as {
  components: { schemas: Record<string, unknown> };
};

/**
 * Quita las anotaciones de OpenAPI 3.0 que JSON Schema 2020-12 no conoce
 * (`example`, `xml`, `discriminator`): son documentación, no reglas.
 */
function sinAnotaciones(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(sinAnotaciones);
  if (nodo === null || typeof nodo !== 'object') return nodo;

  return Object.fromEntries(
    Object.entries(nodo as Record<string, unknown>)
      .filter(([clave]) => !['example', 'xml', 'discriminator'].includes(clave))
      .map(([clave, valor]) => [clave, sinAnotaciones(valor)]),
  );
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema({
  $id: 'contract',
  $defs: sinAnotaciones(
    JSON.parse(JSON.stringify(contrato.components.schemas).replaceAll('#/components/schemas/', '#/$defs/')),
  ),
});

function validador(nombre: string): ReturnType<typeof ajv.getSchema> {
  const validate = ajv.getSchema(`contract#/$defs/${nombre}`);

  if (validate === undefined) throw new Error(`El contrato no define ${nombre}.`);

  return validate;
}

function leer(ruta: string): unknown {
  return JSON.parse(readFileSync(ruta, 'utf8'));
}

function json(ruta: string[]): string[] {
  return readdirSync(join(EJEMPLOS, ...ruta))
    .filter((f) => f.endsWith('.json'))
    .sort();
}

describe('el contrato oficial es el que está en el repositorio, sin tocar', () => {
  it('define los esquemas que este servicio construye', () => {
    for (const nombre of ['TransferRequest', 'TransferResult', 'CancelRequest', 'ReversalRequest']) {
      expect(contrato.components.schemas).toHaveProperty(nombre);
    }
  });
});

describe('los ejemplos del acuerdo, contra el contrato', () => {
  const esquemas = readdirSync(EJEMPLOS).filter((f) => statSync(join(EJEMPLOS, f)).isDirectory());

  it('hay ejemplos de los esquemas que importan', () => {
    expect(esquemas).toEqual(
      expect.arrayContaining(['TransferRequest', 'TransferResult', 'CancelRequest', 'ReversalRequest']),
    );
  });

  describe.each(esquemas)('%s', (nombre) => {
    const validate = validador(nombre);
    const validos = json([nombre]);
    const invalidos = (() => {
      try {
        return json([nombre, 'invalid']);
      } catch {
        return [];
      }
    })();

    it('acepta todos los ejemplos válidos', () => {
      for (const archivo of validos) {
        expect({ archivo, valido: validate?.(leer(join(EJEMPLOS, nombre, archivo))) }).toEqual({
          archivo,
          valido: true,
        });
      }
    });

    it('rechaza todos los ejemplos de invalid/', () => {
      for (const archivo of invalidos) {
        expect({ archivo, valido: validate?.(leer(join(EJEMPLOS, nombre, 'invalid', archivo))) }).toEqual({
          archivo,
          valido: false,
        });
      }
    });
  });

  it('nuestro Zod coincide con el contrato en TransferRequest: acepta los válidos y rechaza los inválidos', () => {
    for (const archivo of json(['TransferRequest'])) {
      expect(v1TransferRequest.safeParse(leer(join(EJEMPLOS, 'TransferRequest', archivo))).success).toBe(true);
    }
    for (const archivo of json(['TransferRequest', 'invalid'])) {
      expect(
        v1TransferRequest.safeParse(leer(join(EJEMPLOS, 'TransferRequest', 'invalid', archivo))).success,
      ).toBe(false);
    }
  });

  it('nuestro Zod coincide con el contrato en TransferResult', () => {
    for (const archivo of json(['TransferResult'])) {
      expect(v1TransferResult.safeParse(leer(join(EJEMPLOS, 'TransferResult', archivo))).success).toBe(true);
    }
    for (const archivo of json(['TransferResult', 'invalid'])) {
      expect(
        v1TransferResult.safeParse(leer(join(EJEMPLOS, 'TransferResult', 'invalid', archivo))).success,
      ).toBe(false);
    }
  });
});

const AHORA = new Date('2026-10-20T15:00:00.000Z');

function envio(overrides: Partial<InterbankSend> = {}): InterbankSend {
  return {
    interbankTransferId: '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01',
    paymentId: '00000000-0000-4000-8000-00000000aaaa',
    transactionId: '00000000-0000-4000-8000-00000000bbbb',
    idempotencyKey: '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01',
    destinationBankCode: 'BANK99',
    destinationAccount: '99-000004567',
    originAccount: '02-000000052',
    customerId: null,
    amount: { amountMinor: 15_000, currency: 'GTQ' },
    correlationId: '00000000-0000-4000-8000-00000000cccc',
    state: 'PENDING',
    reason: null,
    attempts: 0,
    confirmationDueAt: new Date(AHORA.getTime() + 180_000),
    createdAt: AHORA,
    verdictEnqueuedAt: null,
    releaseNotBefore: new Date(AHORA.getTime() + 480_000),
    probe: null,
    cancel: null,
    resolveNotBefore: null,
    probeAttempts: 0,
    cancelAttempts: 0,
    reversal: null,
    decidedAt: null,
    sentAt: null,
    reversedAt: null,
    traceContext: null,
    origin: createEnvelope({}, { messageType: 'payment.requested.v1', producer: 'transaction-service', identity: null }),
    ...overrides,
  };
}

describe('POST /transfers: lo que este banco envía', () => {
  const validate = validador('TransferRequest');

  it('cumple TransferRequest, campo por campo', () => {
    const cuerpo = buildTransferRequest(envio(), 'BANK02');

    expect(validate?.(cuerpo)).toBe(true);
    expect(cuerpo).toEqual({
      interbankTransferId: '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01',
      originBankCode: 'BANK02',
      destinationBankCode: 'BANK99',
      originAccount: '02-000000052',
      destinationAccount: '99-000004567',
      amount: '150.00',
      currency: 'GTQ',
      createdAt: '2026-10-20T15:00:00.000Z',
      expiresAt: '2026-10-20T15:03:00.000Z',
    });
  });

  it('no manda ningún campo del formato provisional', () => {
    const cuerpo = buildTransferRequest(envio(), 'BANK02') as Record<string, unknown>;

    for (const campo of ['accountId', 'idempotencyKey', 'timestamp']) {
      expect(cuerpo).not.toHaveProperty(campo);
    }
  });

  it.each([
    [1, '0.01'],
    [5, '0.05'],
    [100, '1.00'],
    [1_215, '12.15'],
    [999_999, '9999.99'],
    [1_000_000, '10000.00'],
  ])('el monto %i centavos viaja como el texto "%s", nunca como número', (centavos, texto) => {
    const cuerpo = buildTransferRequest(
      envio({ amount: { amountMinor: centavos, currency: 'GTQ' } }),
      'BANK02',
    );

    expect(cuerpo.amount).toBe(texto);
    expect(typeof cuerpo.amount).toBe('string');
    expect(validate?.(cuerpo)).toBe(true);
  });

  it('expiresAt es createdAt + 180 s, exactamente', () => {
    const cuerpo = buildTransferRequest(envio(), 'BANK02');

    expect(new Date(cuerpo.expiresAt).getTime() - new Date(cuerpo.createdAt).getTime()).toBe(180_000);
  });

  it('un reenvío dice exactamente lo mismo que el primer envío', () => {
    // Si no, el otro banco lo vería como «mismo id, contenido distinto» y contestaría 409.
    const primero = buildTransferRequest(envio(), 'BANK02');
    const reenvio = buildTransferRequest(envio({ attempts: 3, state: 'PENDING' }), 'BANK02');

    expect(reenvio).toEqual(primero);
  });

  it('se niega a construir uno sin cuenta origen: el contrato la exige', () => {
    expect(() => buildTransferRequest(envio({ originAccount: null }), 'BANK02')).toThrow(/cuenta origen/);
  });

  it('se niega a construir uno que el contrato rechazaría', () => {
    expect(() => buildTransferRequest(envio({ destinationAccount: 'cuenta con espacios!' }), 'BANK02')).toThrow();
    expect(() => buildTransferRequest(envio({ destinationBankCode: 'BANK_99' }), 'BANK02')).toThrow();
    expect(() => buildTransferRequest(envio({ amount: { amountMinor: 100, currency: 'USD' } }), 'BANK02')).toThrow();
  });
});

describe('POST /transfers/{id}/cancel y POST /reversals', () => {
  it('la cancelación cumple CancelRequest, con un motivo del contrato', () => {
    const cuerpo = buildCancelRequest('BANK02');

    expect(validador('CancelRequest')?.(cuerpo)).toBe(true);
    expect(cuerpo).toEqual({ originBankCode: 'BANK02', reason: 'TIMEOUT' });
  });

  it('el reverso cumple ReversalRequest, con el mismo reversalId para el mismo depósito', () => {
    const reversalId = deterministicUuid('bank-usac/interbank/reversal', envio().interbankTransferId);
    const cuerpo = buildReversalRequest(envio(), reversalId, 'BANK02');

    expect(validador('ReversalRequest')?.(cuerpo)).toBe(true);
    expect(cuerpo).toEqual({
      reversalId,
      originalTransferId: '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01',
      originBankCode: 'BANK02',
      amount: '150.00',
      currency: 'GTQ',
    });
    expect(deterministicUuid('bank-usac/interbank/reversal', envio().interbankTransferId)).toBe(reversalId);
  });
});

function recibido(overrides: Partial<InterbankDeposit> = {}): InterbankDeposit {
  return {
    depositId: '00000000-0000-4000-8000-0000000000d1',
    stage: 'ACCEPTED',
    reason: null,
    origin: createEnvelope({}, { messageType: 'payment.interbank.v1.transfer.query.v1', producer: 'gateway', identity: null }),
    correlationId: '00000000-0000-4000-8000-00000000cccc',
    externalTransferId: '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01',
    originBankCode: 'BANK99',
    accountRef: '02-000000052',
    amount: { amountMinor: 15_000, currency: 'GTQ' },
    callbackAttempts: 0,
    traceContext: null,
    createdAt: AHORA,
    decidedAt: new Date(AHORA.getTime() + 4_000),
    expiresAt: new Date(AHORA.getTime() + 180_000),
    ...overrides,
  };
}

describe('POST /transfers/{id}/result: el callback que este banco devuelve', () => {
  const validate = validador('TransferResult');

  it('un ACCEPTED cumple TransferResult', () => {
    const cuerpo = buildTransferResult(recibido(), 'BANK02');

    expect(validate?.(cuerpo)).toBe(true);
    expect(cuerpo).toEqual({
      interbankTransferId: '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01',
      destinationBankCode: 'BANK02',
      status: 'ACCEPTED',
      processedAt: '2026-10-20T15:00:04.000Z',
    });
  });

  it.each([
    ['ACCOUNT_NOT_FOUND', 'ACCOUNT_NOT_FOUND'],
    ['ACCOUNT_INACTIVE', 'ACCOUNT_INACTIVE'],
    ['AMOUNT_EXCEEDS_LIMIT', 'AMOUNT_LIMIT_EXCEEDED'],
    ['UNSUPPORTED_CURRENCY', 'CURRENCY_NOT_SUPPORTED'],
    ['EXPIRED', 'EXPIRED'],
    ['WRONG_DESTINATION_BANK', 'PROCESSING_ERROR'],
    ['BANK_NOT_AUTHORIZED', 'PROCESSING_ERROR'],
    ['INVALID_REQUEST', 'PROCESSING_ERROR'],
    ['IDEMPOTENCY_CONFLICT', 'PROCESSING_ERROR'],
  ])('un REJECTED por %s sale como %s, uno de los siete del contrato', (motivo, esperado) => {
    const cuerpo = buildTransferResult(recibido({ stage: 'REJECTED', reason: motivo }), 'BANK02');

    expect(validate?.(cuerpo)).toBe(true);
    expect(cuerpo.reasonCode).toBe(esperado);
    expect(cuerpo.status).toBe('REJECTED');
  });

  it('no manda campos desconocidos: el contrato es additionalProperties false', () => {
    const cuerpo = buildTransferResult(recibido({ stage: 'REJECTED', reason: 'EXPIRED' }), 'BANK02');

    expect(Object.keys(cuerpo).sort()).toEqual(
      ['destinationBankCode', 'interbankTransferId', 'processedAt', 'reasonCode', 'reasonMessage', 'status'].sort(),
    );
  });

  it('un depósito sin decidir no tiene resultado que contar', () => {
    expect(() => buildTransferResult(recibido({ stage: 'CREDIT' }), 'BANK02')).toThrow();
    expect(() => buildTransferResult(recibido({ stage: 'CANCELLED', reason: 'CANCELLED' }), 'BANK02')).toThrow();
  });
});
