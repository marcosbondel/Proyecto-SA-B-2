import type { InterbankDeposit, PartnerCallback } from '../src/application/interbank.ports';
import type { InterbankSend, PartnerBankClient } from '../src/application/interbank-send.ports';
import {
  RoutingPartnerBankClient,
  RoutingPartnerCallback,
  partnerRegistry,
} from '../src/infrastructure/http/partner-routing';

/**
 * Several partner banks at once (T-60): each deposit is sent, probed,
 * cancelled, reversed and answered through the client of ITS bank.
 */

function fakeClient(name: string): PartnerBankClient & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    send: async () => {
      calls.push(`${name}:send`);
      return { acknowledged: true, detail: name };
    },
    probe: async () => {
      calls.push(`${name}:probe`);
      return { kind: 'UNREACHABLE' };
    },
    cancel: async () => {
      calls.push(`${name}:cancel`);
      return { kind: 'UNREACHABLE' };
    },
    requestReversal: async () => {
      calls.push(`${name}:requestReversal`);
      return { kind: 'UNREACHABLE' };
    },
    reversalStatus: async () => {
      calls.push(`${name}:reversalStatus`);
      return { kind: 'UNREACHABLE' };
    },
  };
}

const sendTo = (destinationBankCode: string): InterbankSend =>
  ({ destinationBankCode }) as unknown as InterbankSend;

describe('RoutingPartnerBankClient', () => {
  const bank13 = fakeClient('BANK13');
  const bank16 = fakeClient('BANK16');
  const routing = new RoutingPartnerBankClient(
    new Map<string, PartnerBankClient>([
      ['BANK13', bank13],
      ['BANK16', bank16],
    ]),
  );

  beforeEach(() => {
    bank13.calls.length = 0;
    bank16.calls.length = 0;
  });

  it('sends each deposit through the client of its destination bank', async () => {
    await expect(routing.send(sendTo('BANK16'))).resolves.toEqual({
      acknowledged: true,
      detail: 'BANK16',
    });
    expect(bank16.calls).toEqual(['BANK16:send']);
    expect(bank13.calls).toEqual([]);
  });

  it('probes, cancels and reverses through the same bank', async () => {
    const send = sendTo('BANK13');

    await routing.probe(send);
    await routing.cancel(send);
    await routing.requestReversal(send, 'r-1');
    await routing.reversalStatus('r-1', send);

    expect(bank13.calls).toEqual([
      'BANK13:probe',
      'BANK13:cancel',
      'BANK13:requestReversal',
      'BANK13:reversalStatus',
    ]);
    expect(bank16.calls).toEqual([]);
  });

  it('does not acknowledge a deposit to a bank that is not registered', async () => {
    await expect(routing.send(sendTo('BANK55'))).resolves.toEqual({
      acknowledged: false,
      detail: 'PARTNER_NOT_REGISTERED:BANK55',
    });
  });

  it('answers UNREACHABLE for every other call to an unregistered bank, and for a reversal without its deposit', async () => {
    const send = sendTo('BANK55');

    await expect(routing.probe(send)).resolves.toEqual({ kind: 'UNREACHABLE' });
    await expect(routing.cancel(send)).resolves.toEqual({ kind: 'UNREACHABLE' });
    await expect(routing.requestReversal(send, 'r')).resolves.toEqual({ kind: 'UNREACHABLE' });
    await expect(routing.reversalStatus('r')).resolves.toEqual({ kind: 'UNREACHABLE' });
    expect([...bank13.calls, ...bank16.calls]).toEqual([]);
  });

  it('lists the banks it can reach', () => {
    expect(routing.bankCodes).toEqual(['BANK13', 'BANK16']);
  });
});

describe('RoutingPartnerCallback', () => {
  const delivered: string[] = [];
  const callbackOf = (name: string): PartnerCallback => ({
    deliver: async () => {
      delivered.push(name);
    },
  });
  const routing = new RoutingPartnerCallback(
    new Map([
      ['BANK13', callbackOf('BANK13')],
      ['BANK16', callbackOf('BANK16')],
    ]),
  );
  const from = (originBankCode: string): InterbankDeposit =>
    ({ originBankCode }) as unknown as InterbankDeposit;

  it('answers each deposit to the bank that sent it', async () => {
    await routing.deliver(from('BANK16'));
    await routing.deliver(from('BANK13'));

    expect(delivered).toEqual(['BANK16', 'BANK13']);
  });

  it('throws for a bank with no route, so the sweep retries and finally flags it', async () => {
    await expect(routing.deliver(from('BANK55'))).rejects.toThrow(
      'No hay ruta de callback para el banco BANK55',
    );
  });
});

describe('partnerRegistry', () => {
  const legacy = {
    bankCode: 'BANK99',
    baseUrl: 'http://mock:3021/interbank/v1',
    apiKeyOutbound: 'mock-key',
  };
  const bank13 = {
    bankCode: 'BANK13',
    baseUrl: 'https://bank13.example/interbank/v1',
    apiKeyOutbound: 'their-key',
    apiKeyInbound: 'x'.repeat(40),
  };

  it('keeps the legacy partner and adds the registered ones', () => {
    const registry = partnerRegistry({ ownBankCode: 'BANK02', legacy, partners: [bank13] });

    expect([...registry.keys()]).toEqual(['BANK99', 'BANK13']);
    expect(registry.get('BANK13')).toEqual({
      baseUrl: bank13.baseUrl,
      apiKeyOutbound: 'their-key',
    });
  });

  it('leaves the legacy partner out when it has no base URL', () => {
    const registry = partnerRegistry({
      ownBankCode: 'BANK02',
      legacy: { ...legacy, baseUrl: '' },
      partners: [bank13],
    });

    expect([...registry.keys()]).toEqual(['BANK13']);
  });

  it('is empty with neither, which turns sending off', () => {
    expect(
      partnerRegistry({ ownBankCode: 'BANK02', legacy: { ...legacy, baseUrl: '' }, partners: [] })
        .size,
    ).toBe(0);
  });

  it('lets a registered bank replace the legacy one under the same code', () => {
    const registry = partnerRegistry({
      ownBankCode: 'BANK02',
      legacy: { ...legacy, bankCode: 'BANK13' },
      partners: [bank13],
    });

    expect(registry.get('BANK13')?.baseUrl).toBe(bank13.baseUrl);
  });

  it('refuses our own code', () => {
    expect(() =>
      partnerRegistry({
        ownBankCode: 'BANK02',
        legacy,
        partners: [{ ...bank13, bankCode: 'BANK02' }],
      }),
    ).toThrow('propio código');
  });
});
