import { readFileSync } from 'node:fs';

/**
 * El alcance real de la lista de negación de `domain/redaction.ts`, comprobado
 * contra el catálogo de contratos en vez de contra sí misma.
 *
 * Esta prueba no necesita base de datos: lee el catálogo y una constante. Vive
 * fuera de `repository.integration.spec.ts` justamente por eso — esconderla
 * tras el gate de `DATABASE_URL` la dejaría sin correr en un clon sin Docker,
 * que es donde más barato sale enterarse, y la contaría como integración en la
 * pirámide cuando no cruza proceso alguno.
 */
describe('redaction coverage against the contract catalogue', () => {
  /**
   * The tripwire for the gap above.
   *
   * The risk is not that `redaction.ts` is wrong in isolation — it is that a
   * producer somewhere else grows a field the deny-list does not know about,
   * and nothing in this service can see that coming. So this reads the
   * contract catalogue itself and fails the moment a name appears that would
   * carry a real account number rather than an identifier.
   *
   * `accountId`, `sourceAccountId` and friends are the safe shape and are
   * listed as such; anything matching `account`/`iban`/`cuenta` that is *not*
   * on that list is new, and somebody has to decide whether it is sensitive
   * before it reaches this database.
   */
  it('no contract carries an account field this service would fail to redact (TD-073 tripwire)', () => {
    const contracts = readFileSync(require.resolve('@bank/contracts'), 'utf8');

    const KNOWN_SAFE = new Set([
      'accountId',
      'accountIds',
      'accountType',
      'sourceAccountId',
      'targetAccountId',
      'billerAccountId',
      'accountsTotal',
      'accountStatus',
    ]);

    const found = new Set<string>(
      [...contracts.matchAll(/\b([a-z][A-Za-z0-9]*(?:[Aa]ccount|[Ii]ban|[Cc]uenta)[A-Za-z0-9]*)\b/g)].flatMap(
        (match) => (match[1] === undefined ? [] : [match[1]]),
      ),
    );

    const unexpected = [...found].filter((name) => !KNOWN_SAFE.has(name)).sort();

    expect(unexpected).toEqual([]);
  });
});
