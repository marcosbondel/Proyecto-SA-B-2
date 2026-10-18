import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SERVICE = resolve(__dirname, '..');

/**
 * Constitution II and IV, made executable: **no synchronous query, and no
 * access to any other service's database**.
 *
 * It is the claim a reviewer would otherwise have to take on trust, and the one
 * a single well-meaning commit could quietly break — "just reading the
 * transactions table to see whether this transfer is still worth paying" is
 * exactly how a Saga participant becomes a service with a shared database. The search
 * covers the source, the environment template and the declared dependencies,
 * because a violation can hide in any of the three.
 */

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (path.endsWith('.ts')) {
      found.push(path);
    }
  }

  return found;
}

/**
 * Comments are stripped before searching, so prose that *names* a forbidden
 * thing in order to explain why it is forbidden does not fail the test that
 * enforces it.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const SOURCES = sourceFiles(join(SERVICE, 'src')).map((path) => ({
  path: path.slice(SERVICE.length + 1).replace(/\\/g, '/'),
  text: withoutComments(readFileSync(path, 'utf8')),
}));

const PACKAGE = JSON.parse(readFileSync(join(SERVICE, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('this service reads no other service', () => {
  const FOREIGN_TABLES = [
    /\baccounts\b/i,
    /\baccount_operations\b/i,
    /\bcustomers\b/i,
    /\bidentity_documents\b/i,
    /\btransactions\b/i,
    /\btransaction_events\b/i,
    /\bnotifications\b/i,
    /\baudit_events\b/i,
  ];

  it('names no other service in its dependencies', () => {
    const declared = Object.keys({ ...PACKAGE.dependencies, ...PACKAGE.devDependencies });

    expect(declared.filter((name) => /-service$/.test(name) && name !== 'payment-service')).toEqual(
      [],
    );
  });

  it('imports no sibling service', () => {
    for (const source of SOURCES) {
      expect(source.text).not.toMatch(
        /from '.*(customer|account|transaction|notification)-service/,
      );
    }
  });

  /**
   * The load-bearing one. `transaction_id` is an opaque reference and this
   * service must never resolve it — the Saga tells it what to pay and how much,
   * and a join to the transfer that ordered it is how a participant quietly
   * becomes a reader of somebody else's state.
   */
  it('queries no table that belongs to another service', () => {
    const sql = SOURCES.filter((source) => /SELECT|INSERT|UPDATE|DELETE/i.test(source.text));

    for (const source of sql) {
      for (const pattern of FOREIGN_TABLES) {
        /*
         * This service's own names are stripped first, so the word-boundary
         * patterns do not match `transaction_aliases` or the two account
         * columns that are references rather than joins.
         */
        const withoutOwnNames = source.text
          .replace(/payment_attempts/g, '')
          .replace(/payments/g, '')
          .replace(/transaction_id/g, '')
          .replace(/transactionId/g, '');

        expect(withoutOwnNames).not.toMatch(pattern);
      }
    }
  });

  it('declares exactly one database URL, its own', () => {
    const urls = SOURCES.flatMap((source) => source.text.match(/[A-Z_]*DATABASE_URL/g) ?? []);

    expect(new Set(urls)).toEqual(new Set(['DATABASE_URL']));
  });
});

describe('this service speaks to the system only through the broker', () => {
  it('makes HTTP calls only through the fixed partner-bank callback adapter', () => {
    for (const source of SOURCES.filter(
      (file) => file.path !== 'src/infrastructure/http/partner-callback.ts',
    )) {
      // `(?<![.#\w])` so a private method of this service — or any `.fetch(` on
      // an SDK object — is not mistaken for the global.
      expect(source.text).not.toMatch(/(?<![.#\w])fetch\(|axios|node-fetch|HttpService/);
    }
    const adapter = SOURCES.find(
      (file) => file.path === 'src/infrastructure/http/partner-callback.ts',
    );

    expect(adapter?.text).toMatch(/fetch\(`\$\{this\.baseUrl\}/);
    expect(adapter?.text).toMatch(/redirect: 'error'/);

    /**
     * Y **todas** las llamadas de ese archivo apuntan a un destino de la
     * configuración, no sólo la primera.
     *
     * T-46 dejó una sola salida y bastaba con comprobar que existía. T-47 añadió
     * la segunda —el envío del depósito, además del callback de respuesta— y
     * con dos la pregunta deja de ser «¿hay una salida fija?» y pasa a ser
     * «¿son fijas todas?». Un `fetch(payload.callbackUrl)` sería un banco al
     * que cualquiera le dice a dónde mandar el dinero, y la prueba anterior lo
     * habría dejado pasar mientras la primera llamada siguiera siendo correcta.
     */
    const llamadas = adapter?.text.match(/(?<![.#\w])fetch\(/g) ?? [];
    /*
     * Dos formas de empezar una URL, y las dos tienen que arrancar en `this.`:
     *
     *   fetch(this.endpoint, …)                    — el destino entero
     *   fetch(`${this.apiBaseUrl}/transfers/…`, …) — la base más un camino fijo
     *
     * La segunda la añadió TD-095, porque el protocolo de TIMEOUT necesita
     * `GET /transfers/{id}` y `POST /transfers/{id}/cancel`. Lo que la prueba
     * sigue impidiendo es lo único que importa: que la URL empiece en algo que
     * no sea configuración. Un `fetch(`${payload.baseUrl}/…`)` no coincide, que
     * es el punto — sería un banco al que cualquiera le dice a dónde mandar el
     * dinero.
     */
    const configuradas =
      adapter?.text.match(/(?<![.#\w])fetch\(\s*(?:this\.[A-Za-z]+|`\$\{this\.[A-Za-z]+)/g) ??
      [];

    /*
     * Una: desde T-60 toda salida —el envío, la consulta, la cancelación, el
     * reverso y el callback— pasa por `PartnerHttp.call`, que es donde se ponen
     * `X-Api-Key` y `traceparent`. Antes eran cuatro `fetch` con las cabeceras
     * repetidas cuatro veces, que es como una ruta nueva se olvida de una. El
     * número se mueve a mano cuando la salida crece a propósito, que es justo lo
     * que lo convierte en una decisión y no en un descuido.
     */
    expect(llamadas).toHaveLength(1);
    expect(configuradas).toHaveLength(llamadas.length);
  });

  it('exposes HTTP for health and readiness only', () => {
    const controllers = SOURCES.filter((source) => /@Controller/.test(source.text));

    expect(controllers.map((source) => source.path)).toEqual([
      'src/interfaces/health.controller.ts',
    ]);

    for (const source of controllers) {
      const routes = source.text.match(/@(Get|Post|Patch|Put|Delete)\('([^']*)'\)/g) ?? [];

      expect(routes.sort()).toEqual(["@Get('health')", "@Get('ready')"]);
    }
  });
});

describe('the layers point inward', () => {
  it('keeps the domain free of frameworks, contracts and drivers', () => {
    // The lint rules enforce this too; asserting it here makes the reason
    // visible next to the rules it protects.
    for (const source of SOURCES.filter((file) => file.path.startsWith('src/domain/'))) {
      expect(source.text).not.toMatch(/from '(@nestjs|@bank|pg|@aws-sdk)/);
    }
  });

  it('keeps the transport out of the application layer', () => {
    for (const source of SOURCES.filter((file) => file.path.startsWith('src/application/'))) {
      expect(source.text).not.toMatch(/from '(@bank\/messaging|pg|@aws-sdk)/);
    }
  });
});

describe('the retry decision lives in one place', () => {
  /**
   * Whether a payment retries is decided in `domain/payment.ts` and nowhere
   * else. The scenario strings are the tell: if they start appearing in
   * comparisons in a handler or a repository, some other file has begun
   * deciding what the provider said — and that decision is the one thing here
   * that must stay testable without a clock or a database.
   */
  it('compares a scenario nowhere but the domain', () => {
    const offenders = SOURCES.filter(
      (source) =>
        !source.path.startsWith('src/domain/') &&
        /(===|!==)\s*'(APPROVE|REJECT|TRANSIENT_FAILURE|TIMEOUT)'/.test(source.text),
    );

    expect(offenders.map((source) => source.path)).toEqual([]);
  });
});

describe('the Saga payment publisher orders nothing from anybody', () => {
  /**
   * Payment Service is the end of the command chain. A `send` on the publisher,
   * or a publish onto the commands exchange, would mean it had begun telling
   * another service what to do — a different Saga from the one every diagram in
   * the repository draws.
   */
  it('has no way to publish a command', () => {
    /**
     * The *publisher* is what is being asserted, not `main.ts`. Composition
     * declares all three exchanges because the queue this service consumes is
     * bound to `bank.commands` and the exchange has to exist for the binding to
     * succeed — declaring it is not a route to publishing on it. The route
     * would be here.
     */
    const publishers = SOURCES.filter(
      (source) => source.path === 'src/infrastructure/messaging/broker-event.publisher.ts',
    );

    expect(publishers.map((source) => source.path)).toEqual([
      'src/infrastructure/messaging/broker-event.publisher.ts',
    ]);

    for (const source of publishers) {
      expect(source.text).not.toMatch(/EXCHANGES\.commands/);
    }
    const interbank = SOURCES.find(
      (source) => source.path === 'src/infrastructure/messaging/broker-interbank.messenger.ts',
    );
    expect(interbank?.text).toMatch(/EXCHANGES\.commands/);
  });

  it('offers no `send` on the port the application layer holds', () => {
    const ports = SOURCES.filter((source) => source.path === 'src/application/ports.ts');

    for (const source of ports) {
      const publisher = /interface EventPublisher \{([^}]*)\}/.exec(source.text)?.[1] ?? '';

      expect(publisher).not.toMatch(/\bsend\s*\(/);
      expect(publisher).toMatch(/publish\s*\(/);
      expect(publisher).toMatch(/reply\s*\(/);
    }
  });
});
