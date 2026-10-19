import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { V1_MAX_AMOUNT_MINOR } from '@bank/contracts';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

import { MAX_LATENCY_MS, isValidSettings } from '../../domain/simulation';

/**
 * Raised when a required environment variable is missing or malformed.
 * The message names every offending variable so the operator does not have to
 * guess which one broke the boot (FR-013).
 */
export class EnvironmentValidationError extends Error {
  public readonly variables: readonly string[];

  constructor(variables: readonly string[], details: string) {
    super(
      `Invalid environment for "payment-service". Offending variables: ${variables.join(', ')}\n${details}`,
    );
    this.name = 'EnvironmentValidationError';
    this.variables = variables;
  }
}

/**
 * DATABASE_URL points at this service's own database and no other
 * (constitution II).
 */
export class PaymentServiceEnvironment {
  @IsIn(['development', 'test', 'production'])
  public NODE_ENV!: 'development' | 'test' | 'production';

  @IsInt()
  @Min(1)
  @Max(65535)
  public PORT!: number;

  @IsString()
  @IsNotEmpty()
  public DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  public RABBITMQ_URL!: string;

  /**
   * The delays between payment attempts, in milliseconds, comma-separated.
   *
   * Defaults to the ladder `docs/events/topology.md` fixed for the broker's own
   * retries — 1 s, 5 s, 30 s, so four attempts at most. It is a variable and
   * not a constant because a demonstration cannot spend thirty-six seconds
   * watching a compensation everybody in the room already understands.
   *
   * An empty list is legal and means one attempt with no ladder: a payment
   * either works or fails permanently. It is the shape a real provider with its
   * own internal retries would want.
   */
  @IsString()
  public PAYMENT_RETRY_DELAYS_MS!: string;

  /**
   * How often the sweeper looks for attempts the ladder owes.
   *
   * It bounds how late a retry can be, so it has to be well under the smallest
   * rung or the ladder's timing becomes the sweep interval's timing.
   */
  @IsInt()
  @Min(100)
  @Max(600_000)
  public PAYMENT_RETRY_SWEEP_MS!: number;

  /**
   * How slowly the sweepers may poll **while there is nothing to do** (T-60).
   *
   * `PAYMENT_RETRY_SWEEP_MS` is the interval while there is work, and the floor
   * the loop returns to the moment a tick finds some or a delivery arrives. When
   * a tick finds nothing the delay doubles up to this ceiling, so an idle pod
   * stops spending CPU (and database transactions) on empty sweeps — at 500 ms
   * and no backoff an idle replica sat above its 50 m request and held the
   * HorizontalPodAutoscaler at its maximum with no traffic.
   *
   * It is also the **worst lateness** of anything the clock makes due while the
   * pod is idle and nothing woke it: a retry rung, a deposit's expiry, a lease
   * that lapsed. On the default 1 s / 5 s / 30 s ladder 2 s keeps every rung
   * within its own order of magnitude, and a retry still never fires *early*.
   * Set it equal to `PAYMENT_RETRY_SWEEP_MS` to turn the backoff off.
   */
  @IsInt()
  @Min(100)
  @Max(600_000)
  public PAYMENT_RETRY_SWEEP_IDLE_MAX_MS!: number;

  /**
   * How the simulated provider behaves until an administrator changes it
   * (Fase 3, T-44): the share of attempts that fail, the share that time out,
   * and how long an answer takes. The ConfigMap supplies them; an override made
   * at run time takes precedence and is removed by a reset, which brings these
   * back. All zero by default, so an unconfigured deployment behaves as the
   * provider did before this ticket.
   */
  @IsNumber()
  @Min(0)
  @Max(100)
  public PAYMENT_SIM_FAILURE_RATE!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  public PAYMENT_SIM_TIMEOUT_RATE!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_LATENCY_MS)
  public PAYMENT_SIM_LATENCY_MS!: number;

  @IsString()
  @IsNotEmpty()
  public INTERBANK_BANK_CODE!: string;

  @IsString()
  @IsNotEmpty()
  public INTERBANK_PARTNER_BANK_CODE!: string;

  /**
   * El límite por operación, en centavos: **uno solo, para recibir y para
   * enviar** (B7).
   *
   * Antes eran dos y no se parecían: el camino nuevo tenía Q10 000 fijos en el
   * código y esta variable (Q1 000 000) sólo gobernaba el provisional, y enviar
   * no tenía límite. El techo es el del contrato —`10000.00`— y la variable sólo
   * puede **bajarlo**: un límite mayor haría a este banco aceptar y mandar
   * depósitos que cualquier pareja que cumpla el contrato rechaza con
   * `AMOUNT_LIMIT_EXCEEDED`.
   */
  @IsInt()
  @Min(1)
  @Max(V1_MAX_AMOUNT_MINOR)
  public INTERBANK_MAX_AMOUNT_MINOR!: number;

  /**
   * La API del banco pareja, **con** el prefijo `/interbank/v1`
   * (`http://host/interbank/v1`): de aquí salen el envío, la consulta, la
   * cancelación, el reverso y —derivado, no configurado— el callback.
   *
   * Vacío significa «este despliegue no envía depósitos»: el bloque `interbank`
   * de un pago se ignora y el pago va al proveedor simulado, que es lo correcto
   * para un entorno sin pareja asignada. No se valida como URL con `@IsUrl` a
   * propósito — en el clúster el destino es un nombre de Service
   * (`http://partner-mock:3021/interbank/v1`), que no pasa ese validador y es
   * exactamente lo que hay que poner.
   *
   * Sustituye a `INTERBANK_SEND_URL` y `INTERBANK_CALLBACK_URL` (T-60): el
   * acuerdo de integración fija que el callback no se configura sino que se
   * deriva de la URL base de la pareja.
   */
  @IsString()
  public INTERBANK_PARTNER_BASE_URL!: string;

  /**
   * La API key que **mandamos** a la pareja en `X-Api-Key` (secreto). La que
   * exigimos nosotros a quien nos llama (`INTERBANK_API_KEY_INBOUND`) es del
   * Gateway y este servicio no la lee jamás. Vacía = no se puede hablar con la
   * pareja, y el envío lo dice en vez de mandar sin autenticar.
   */
  @IsString()
  public INTERBANK_API_KEY_OUTBOUND!: string;

  /**
   * Cuánto se espera la confirmación del banco pareja antes de rendirse y
   * compensar.
   *
   * **OBSOLETA desde TD-095, y se sigue aceptando a propósito.** El plazo de un
   * depósito interbancario lo fija el CONTRATO —`V1_TRANSFER_TTL_MS`, 180 s, más
   * un margen de `V1_RELEASE_MARGIN_MS` antes de poder liberar a ciegas— y no
   * una variable de entorno: un plazo de interoperabilidad que cada banco
   * configura a su gusto no es un plazo, y con 30 s aquí dábamos por muerto lo
   * que para el otro lado seguía vivo durante 24 horas.
   *
   * Ya no se lee. Se mantiene declarada para que un despliegue que todavía la
   * ponga en su ConfigMap no falle la validación de arranque; quitarla del chart
   * es seguro y no hace falta coordinarlo.
   */
  @IsInt()
  @Min(1_000)
  @Max(600_000)
  public INTERBANK_CONFIRMATION_TIMEOUT_MS!: number;

  /**
   * Cada cuánto se reintenta un paso del protocolo de TIMEOUT que no obtuvo
   * respuesta (TD-095).
   *
   * Ésta sí es nuestra y no del contrato: el acuerdo dice cuándo se puede
   * liberar, no con qué frecuencia preguntamos. Cinco segundos por defecto —
   * suficiente para no apretar a un banco que ya va mal, y suficientemente
   * frecuente para que los 300 s del margen den para unos sesenta intentos.
   */
  @IsInt()
  @Min(500)
  @Max(60_000)
  public INTERBANK_RESOLVE_RETRY_MS!: number;
}

/**
 * `"1000,5000,30000"` as the numbers the domain wants.
 *
 * Rejects anything that is not a list of non-negative integers, because a
 * malformed ladder that silently became `[NaN]` would be a payment that retries
 * immediately, forever.
 */
export function parseRetryDelays(raw: string): readonly number[] {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return [];
  }

  return trimmed.split(',').map((piece) => {
    const value = Number(piece.trim());

    if (!Number.isInteger(value) || value < 0) {
      throw new EnvironmentValidationError(
        ['PAYMENT_RETRY_DELAYS_MS'],
        `  - PAYMENT_RETRY_DELAYS_MS: "${piece.trim()}" is not a non-negative integer of milliseconds`,
      );
    }

    return value;
  });
}

/**
 * Loads `.env` into `process.env` when the file exists. Uses the Node built-in
 * loader, so no dotenv dependency enters the tree.
 */
export function loadDotEnvFile(directory: string = process.cwd()): void {
  const envFile = resolve(directory, '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

/** Validates the process environment, or throws naming what is wrong. */
export function loadEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): PaymentServiceEnvironment {
  const candidate = plainToInstance(PaymentServiceEnvironment, {
    NODE_ENV: source.NODE_ENV,
    PORT: toInteger(source.PORT),
    DATABASE_URL: source.DATABASE_URL,
    RABBITMQ_URL: source.RABBITMQ_URL,
    PAYMENT_RETRY_DELAYS_MS: source.PAYMENT_RETRY_DELAYS_MS ?? '1000,5000,30000',
    PAYMENT_RETRY_SWEEP_MS: toInteger(source.PAYMENT_RETRY_SWEEP_MS) ?? 500,
    PAYMENT_RETRY_SWEEP_IDLE_MAX_MS: toInteger(source.PAYMENT_RETRY_SWEEP_IDLE_MAX_MS) ?? 2_000,
    PAYMENT_SIM_FAILURE_RATE: toNumber(source.PAYMENT_SIM_FAILURE_RATE) ?? 0,
    PAYMENT_SIM_TIMEOUT_RATE: toNumber(source.PAYMENT_SIM_TIMEOUT_RATE) ?? 0,
    PAYMENT_SIM_LATENCY_MS: toInteger(source.PAYMENT_SIM_LATENCY_MS) ?? 0,
    INTERBANK_BANK_CODE: source.INTERBANK_BANK_CODE ?? 'BANK02',
    INTERBANK_PARTNER_BANK_CODE: source.INTERBANK_PARTNER_BANK_CODE ?? 'BANK99',
    INTERBANK_MAX_AMOUNT_MINOR:
      toInteger(source.INTERBANK_MAX_AMOUNT_MINOR) ?? V1_MAX_AMOUNT_MINOR,
    INTERBANK_PARTNER_BASE_URL: (source.INTERBANK_PARTNER_BASE_URL ?? '').replace(/\/+$/, ''),
    INTERBANK_API_KEY_OUTBOUND: source.INTERBANK_API_KEY_OUTBOUND ?? '',
    INTERBANK_CONFIRMATION_TIMEOUT_MS:
      toInteger(source.INTERBANK_CONFIRMATION_TIMEOUT_MS) ?? 30_000,
    INTERBANK_RESOLVE_RETRY_MS: toInteger(source.INTERBANK_RESOLVE_RETRY_MS) ?? 5_000,
  });

  const errors = validateSync(candidate, { skipMissingProperties: false, whitelist: true });

  if (errors.length > 0) {
    const variables = errors.map((error) => error.property);
    const details = errors
      .map((error) => `  - ${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`)
      .join('\n');
    throw new EnvironmentValidationError(variables, details);
  }

  parseRetryDelays(candidate.PAYMENT_RETRY_DELAYS_MS);

  // Each rate is in range on its own; together a failure and a timeout are two
  // ways one attempt goes wrong, so they cannot exceed every attempt.
  if (!isValidSettings(simulationDefaults(candidate))) {
    throw new EnvironmentValidationError(
      ['PAYMENT_SIM_FAILURE_RATE', 'PAYMENT_SIM_TIMEOUT_RATE'],
      '  - PAYMENT_SIM_FAILURE_RATE + PAYMENT_SIM_TIMEOUT_RATE must not exceed 100',
    );
  }

  return candidate;
}

/** The ConfigMap's three numbers, as the domain's settings. */
export function simulationDefaults(environment: PaymentServiceEnvironment): {
  readonly failureRatePercent: number;
  readonly timeoutRatePercent: number;
  readonly latencyMs: number;
} {
  return {
    failureRatePercent: environment.PAYMENT_SIM_FAILURE_RATE,
    timeoutRatePercent: environment.PAYMENT_SIM_TIMEOUT_RATE,
    latencyMs: environment.PAYMENT_SIM_LATENCY_MS,
  };
}

/** `undefined` when absent, `NaN` when present but not an integer. */
function toInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

/** `undefined` when absent, `NaN` when present but not a number. */
function toNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  return Number(raw);
}
