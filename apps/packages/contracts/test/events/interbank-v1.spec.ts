import {
  V1_MAX_AMOUNT_MINOR,
  V1_RELEASE_MARGIN_MS,
  V1_TRANSFER_TTL_MS,
  v1AmountFromMinor,
  v1AmountToMinor,
  v1ExpiresAt,
  v1CancelRequest,
  v1ReasonCode,
  v1ReversalRequest,
  v1TransferRequest,
  v1TransferResult,
} from '../../src/events/interbank/v1';

/**
 * El contrato oficial, comprobado contra **el archivo** y no contra lo que
 * recordamos de él (`docs/references/interbank-contract-v1.openapi.yaml`).
 */

const PETICION = {
  interbankTransferId: '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01',
  originBankCode: 'BANK07',
  destinationBankCode: 'BANK02',
  originAccount: '7002-004567',
  destinationAccount: '02-000000052',
  amount: '150.00',
  currency: 'GTQ' as const,
  createdAt: '2026-10-20T15:00:00.000Z',
  expiresAt: '2026-10-20T15:03:00.000Z',
};

describe('el monto, como texto y sin coma flotante', () => {
  it('formatea centavos al texto del contrato', () => {
    expect(v1AmountFromMinor(15_000)).toBe('150.00');
    expect(v1AmountFromMinor(1)).toBe('0.01');
    expect(v1AmountFromMinor(115)).toBe('1.15');
    expect(v1AmountFromMinor(0)).toBe('0.00');
    expect(v1AmountFromMinor(1_000_000)).toBe('10000.00');
  });

  it('va y vuelve sin perder un centavo, incluidos los que el float arruina', () => {
    // `1.15 * 100` es 114.99999999999999 y `0.07 * 100` es 7.000000000000001.
    for (const centavos of [1, 7, 115, 1_999, 12_345, 999_999, 1_000_000]) {
      expect(v1AmountToMinor(v1AmountFromMinor(centavos))).toBe(centavos);
    }
  });

  it('rechaza un texto que no es el del contrato, en vez de interpretarlo', () => {
    expect(v1AmountToMinor('150')).toBeNull();
    expect(v1AmountToMinor('150.0')).toBeNull();
    expect(v1AmountToMinor('150.000')).toBeNull();
    expect(v1AmountToMinor('1,50')).toBeNull();
    expect(v1AmountToMinor('-1.50')).toBeNull();
    expect(v1AmountToMinor('')).toBeNull();
  });

  it('se niega a formatear algo que no es un entero de centavos', () => {
    expect(() => v1AmountFromMinor(1.5)).toThrow(RangeError);
    expect(() => v1AmountFromMinor(-1)).toThrow(RangeError);
  });
});

describe('el cuerpo del depósito', () => {
  it('acepta el ejemplo del propio contrato', () => {
    expect(v1TransferRequest.safeParse(PETICION).success).toBe(true);
  });

  it('exige los ocho campos obligatorios', () => {
    for (const campo of [
      'interbankTransferId',
      'originBankCode',
      'destinationBankCode',
      'originAccount',
      'destinationAccount',
      'amount',
      'currency',
      'createdAt',
      'expiresAt',
    ] as const) {
      const { [campo]: _, ...sinEse } = PETICION;

      expect(v1TransferRequest.safeParse(sinEse).success).toBe(false);
    }
  });

  it('rechaza un código de banco que no es `BANK` y dos dígitos', () => {
    // Los dos que este repositorio usaba antes de leer el contrato.
    for (const codigo of ['BANK_USAC', 'PARTNER_MOCK', 'BANK2', 'bank02', 'BANK002']) {
      expect(v1TransferRequest.safeParse({ ...PETICION, originBankCode: codigo }).success).toBe(
        false,
      );
    }
    expect(v1TransferRequest.safeParse({ ...PETICION, originBankCode: 'BANK99' }).success).toBe(
      true,
    );
  });

  it('rechaza una cuenta de más de 34 caracteres, que es por lo que un UUID no cabe', () => {
    const uuid = '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01';

    expect(uuid).toHaveLength(36);
    expect(v1TransferRequest.safeParse({ ...PETICION, destinationAccount: uuid }).success).toBe(
      false,
    );
  });

  it('rechaza un campo que el contrato no tiene', () => {
    expect(v1TransferRequest.safeParse({ ...PETICION, nuestro: true }).success).toBe(false);
  });

  it('acepta un monto por encima del límite: el límite es de negocio, no de sintaxis', () => {
    // 50 000,00 es sintácticamente válido y se rechaza por callback con
    // AMOUNT_LIMIT_EXCEEDED. Convertirlo en un 400 perdería el motivo.
    expect(v1TransferRequest.safeParse({ ...PETICION, amount: '50000.00' }).success).toBe(true);
    expect(v1AmountToMinor('50000.00')).toBeGreaterThan(V1_MAX_AMOUNT_MINOR);
  });
});

describe('el callback', () => {
  it('acepta los dos ejemplos del contrato', () => {
    expect(
      v1TransferResult.safeParse({
        interbankTransferId: PETICION.interbankTransferId,
        destinationBankCode: 'BANK02',
        status: 'ACCEPTED',
        processedAt: '2026-10-20T15:00:04.000Z',
      }).success,
    ).toBe(true);

    expect(
      v1TransferResult.safeParse({
        interbankTransferId: PETICION.interbankTransferId,
        destinationBankCode: 'BANK02',
        status: 'REJECTED',
        reasonCode: 'ACCOUNT_NOT_FOUND',
        reasonMessage: 'La cuenta destino no existe',
        processedAt: '2026-10-20T15:00:02.000Z',
      }).success,
    ).toBe(true);
  });

  it('no admite PROCESSING ni CANCELLED: un callback informa un veredicto', () => {
    for (const status of ['PROCESSING', 'CANCELLED']) {
      expect(
        v1TransferResult.safeParse({
          interbankTransferId: PETICION.interbankTransferId,
          destinationBankCode: 'BANK02',
          status,
          processedAt: '2026-10-20T15:00:04.000Z',
        }).success,
      ).toBe(false);
    }
  });
});

describe('los motivos de rechazo', () => {
  it('son los siete del contrato y ninguno más', () => {
    expect(v1ReasonCode.options).toEqual([
      'ACCOUNT_NOT_FOUND',
      'ACCOUNT_INACTIVE',
      'AMOUNT_LIMIT_EXCEEDED',
      'CURRENCY_NOT_SUPPORTED',
      'EXPIRED',
      'CANCELLED',
      'PROCESSING_ERROR',
    ]);
  });

  it('no incluye los tres nuestros que en realidad son códigos HTTP', () => {
    // BANK_NOT_AUTHORIZED es un 401, IDEMPOTENCY_CONFLICT un 409, y
    // WRONG_DESTINATION_BANK no existe: cae en PROCESSING_ERROR.
    for (const nuestro of [
      'BANK_NOT_AUTHORIZED',
      'IDEMPOTENCY_CONFLICT',
      'WRONG_DESTINATION_BANK',
      'AMOUNT_EXCEEDS_LIMIT',
      'UNSUPPORTED_CURRENCY',
      'INVALID_REQUEST',
    ]) {
      expect(v1ReasonCode.safeParse(nuestro).success).toBe(false);
    }
  });
});

describe('los tiempos, que el contrato fija y no se negocian', () => {
  it('la vigencia son 180 segundos exactos', () => {
    expect(V1_TRANSFER_TTL_MS).toBe(180_000);
    expect(v1ExpiresAt(new Date('2026-10-20T15:00:00.000Z')).toISOString()).toBe(
      '2026-10-20T15:03:00.000Z',
    );
  });

  it('el margen antes de liberar son 300 segundos después del vencimiento', () => {
    // Liberar antes es arriesgarse a que el receptor haya acreditado y esté
    // reintentando su callback: el mismo dinero saldría dos veces.
    expect(V1_RELEASE_MARGIN_MS).toBe(300_000);
    expect(V1_RELEASE_MARGIN_MS).toBeGreaterThan(V1_TRANSFER_TTL_MS / 2);
  });

  it('el máximo por operación son Q10 000,00', () => {
    expect(V1_MAX_AMOUNT_MINOR).toBe(1_000_000);
    expect(v1AmountFromMinor(V1_MAX_AMOUNT_MINOR)).toBe('10000.00');
  });
});

describe('qué esquemas son estrictos, y cuáles no por decisión del contrato', () => {
  it('rechaza un campo de más en el depósito y en el resultado', () => {
    // Los dos únicos con `additionalProperties: false` en el contrato oficial.
    expect(v1TransferRequest.safeParse({ ...PETICION, extra: 1 }).success).toBe(false);
    expect(
      v1TransferResult.safeParse({
        interbankTransferId: PETICION.interbankTransferId,
        destinationBankCode: 'BANK02',
        status: 'ACCEPTED',
        processedAt: '2026-10-20T15:00:04.000Z',
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it('acepta un campo de más al cancelar y al pedir un reverso', () => {
    /*
     * El contrato **no** declara `additionalProperties: false` en estos dos, así
     * que rechazarlos sería modificarlo por nuestra cuenta — y ser más estricto
     * que el contrato rompe la interoperabilidad igual que ser más laxo, sólo
     * que el fallo lo sufre el otro banco. Lo encontró la validación de
     * ejemplos del repositorio del contrato.
     */
    expect(
      v1CancelRequest.safeParse({
        originBankCode: 'BANK99',
        reason: 'TIMEOUT',
        note: 'reintento manual del operador',
      }).success,
    ).toBe(true);

    expect(
      v1ReversalRequest.safeParse({
        reversalId: '62536908-839e-419a-89b4-21cea06edbcc',
        originalTransferId: PETICION.interbankTransferId,
        originBankCode: 'BANK99',
        amount: '150.00',
        currency: 'GTQ',
        openedBy: 'mesa de operaciones',
      }).success,
    ).toBe(true);
  });

  it('pero sigue exigiendo los campos y los formatos', () => {
    expect(v1CancelRequest.safeParse({ originBankCode: 'BANK99' }).success).toBe(false);
    expect(
      v1CancelRequest.safeParse({ originBankCode: 'BANK99', reason: 'PORQUE_SI' }).success,
    ).toBe(false);
  });
});
