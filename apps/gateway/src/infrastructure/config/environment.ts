import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { V1_MAX_AMOUNT_MINOR } from '@bank/contracts';
import { DEFAULT_REPLY_TIMEOUT_MS } from '@bank/messaging';

import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Raised when a required environment variable is missing or malformed.
 * The message names every offending variable so the operator does not have to
 * guess which one broke the boot (FR-013).
 */
export class EnvironmentValidationError extends Error {
  public readonly variables: readonly string[];

  constructor(variables: readonly string[], details: string) {
    super(
      `Invalid environment for "gateway". Offending variables: ${variables.join(', ')}\n${details}`,
    );
    this.name = 'EnvironmentValidationError';
    this.variables = variables;
  }
}

/**
 * The gateway declares no `DATABASE_URL`: it never reads a database
 * (constitution V — the gateway routes and validates shape, nothing else).
 */
export class GatewayEnvironment {
  @IsIn(['development', 'test', 'production'])
  public NODE_ENV!: 'development' | 'test' | 'production';

  @IsInt()
  @Min(1)
  @Max(65535)
  public PORT!: number;

  @IsString()
  @IsNotEmpty()
  public RABBITMQ_URL!: string;

  /**
   * The HS256 signing secret. The gateway is both the only signer and the only
   * validator (ADR-010), so this never leaves the process — and it never
   * enters the repository, an image, or a values file (FR-016).
   *
   * The 32-character floor is not decoration: HS256 with a short secret is
   * brute-forceable offline by anyone holding one issued token.
   */
  @IsString()
  @MinLength(32)
  public JWT_SECRET!: string;

  /** Seconds. One hour, fixed by ADR-010, which also rules out refresh. */
  @IsInt()
  @Min(1)
  @Max(3600)
  public JWT_EXPIRES_IN!: number;

  /**
   * Names this replica's private reply queue.
   *
   * A durable queue shared by every replica would have the broker deliver
   * replies round-robin, so the answer to one instance's question could land
   * on an instance with nobody waiting for it.
   */
  @IsString()
  @IsNotEmpty()
  public GATEWAY_INSTANCE_ID!: string;

  /**
   * Milliseconds a reply is waited for. Five seconds, fixed by T-05.
   *
   * It is configurable so a test can shorten it, not so an operator can tune
   * it: every query in the system shares this ceiling.
   */
  @IsInt()
  @Min(1)
  @Max(30_000)
  public REPLY_TIMEOUT_MS!: number;

  /** MinIO's S3 endpoint. The bucket is a transfer buffer, not a database. */
  @IsUrl({ require_tld: false })
  public OBJECT_STORAGE_ENDPOINT!: string;

  @IsString()
  @IsNotEmpty()
  public OBJECT_STORAGE_ACCESS_KEY!: string;

  @IsString()
  @IsNotEmpty()
  public OBJECT_STORAGE_SECRET_KEY!: string;

  @IsString()
  @IsNotEmpty()
  public OBJECT_STORAGE_BUCKET!: string;

  /** MinIO ignores it; the AWS SDK refuses to build a client without it. */
  @IsString()
  @IsNotEmpty()
  public OBJECT_STORAGE_REGION!: string;

  /**
   * The browser origins allowed to call the gateway, comma-separated.
   *
   * The frontend is served from a different origin than the gateway
   * (`:3010` vs `:3000` locally), so every call it makes is cross-origin. A
   * browser refuses to read the response unless the gateway names the origin
   * back — without this the whole frontend fails with a network error while
   * `curl`, which does not enforce the same-origin policy, keeps working.
   *
   * A list rather than `*` on purpose: `*` cannot be combined with credentials
   * and hands the API to any page on the internet. In development the frontend
   * lives at `http://localhost:3010`; a deployment names its own origins.
   */
  @IsString()
  @IsNotEmpty()
  public CORS_ALLOWED_ORIGINS!: string;

  /**
   * The shared secret the SLO webhook demands (T-45). Optional on purpose: a
   * Gateway without one still serves everything else, and the webhook refuses
   * every call rather than opening — see `AlertTokenGuard`. In a cluster it
   * comes from a Secret; it must be as long as the session secret, because a
   * short one is brute-forceable from outside the cluster.
   */
  @IsOptional()
  @IsString()
  @MinLength(32)
  public ALERT_WEBHOOK_TOKEN?: string;

  /** Shared with the one configured partner bank; absent means ingress is closed. */
  @IsOptional()
  @IsString()
  @MinLength(32)
  public INTERBANK_PARTNER_TOKEN?: string;

  /**
   * La API key que **exigimos** a quien nos llama por `/interbank/v1` (T-56).
   *
   * Es la del contrato oficial (`X-Api-Key`) y es distinta del
   * `INTERBANK_PARTNER_TOKEN` de T-46, que era un `Bearer` compartido para las
   * rutas de `/api/`. Conviven porque las rutas viejas siguen sirviendo al
   * frontend; lo que no conviven es su significado: ésta **identifica** al banco
   * que llama, y de eso dependen dos reglas del contrato que un token
   * compartido no puede cumplir.
   *
   * Ausente significa que la entrada del contrato está cerrada, y el guardián
   * responde `401` a todo el mundo. Es preferible a arrancar con una clave vacía
   * que cualquiera adivina.
   */
  @IsOptional()
  @IsString()
  @MinLength(32)
  public INTERBANK_API_KEY_INBOUND?: string;

  /**
   * Los bancos pareja registrados, como JSON (T-60): ver
   * `parseInterbankPartners` en `@bank/contracts`. Se suma al de
   * `INTERBANK_PARTNER_BANK_CODE`; ausente, sólo queda ése.
   */
  @IsOptional()
  @IsString()
  public INTERBANK_PARTNERS?: string;

  /** Nuestro código de banco. `GET /interbank/v1/health` lo publica. */
  @IsString()
  @Matches(/^BANK[0-9]{2}$/, { message: 'INTERBANK_BANK_CODE debe cumplir ^BANK[0-9]{2}$' })
  public INTERBANK_BANK_CODE!: string;

  /** El código del banco pareja, al que corresponde la API key de entrada. */
  @IsString()
  @Matches(/^BANK[0-9]{2}$/, { message: 'INTERBANK_PARTNER_BANK_CODE debe cumplir ^BANK[0-9]{2}$' })
  public INTERBANK_PARTNER_BANK_CODE!: string;

  /**
   * El límite por operación, en centavos: **el mismo** que aplica Payment al
   * recibir y al enviar (T-60, B7). El Gateway lo lee para rechazar un envío
   * por encima del límite en el borde, antes de debitar nada; Payment lo vuelve
   * a aplicar por si algo llegó por otro camino. El techo es el del contrato
   * (`10000.00`): la variable sólo puede bajarlo.
   */
  @IsInt()
  @Min(1)
  @Max(V1_MAX_AMOUNT_MINOR)
  public INTERBANK_MAX_AMOUNT_MINOR!: number;
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
export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): GatewayEnvironment {
  const candidate = plainToInstance(GatewayEnvironment, {
    NODE_ENV: source.NODE_ENV,
    PORT: toInteger(source.PORT),
    RABBITMQ_URL: source.RABBITMQ_URL,
    JWT_SECRET: source.JWT_SECRET,
    JWT_EXPIRES_IN: toInteger(source.JWT_EXPIRES_IN) ?? 3600,
    // A per-process default keeps replies flowing in development, where nobody
    // sets this, without ever letting two replicas share one queue.
    GATEWAY_INSTANCE_ID: source.GATEWAY_INSTANCE_ID ?? randomUUID(),
    REPLY_TIMEOUT_MS: toInteger(source.REPLY_TIMEOUT_MS) ?? DEFAULT_REPLY_TIMEOUT_MS,
    OBJECT_STORAGE_ENDPOINT: source.OBJECT_STORAGE_ENDPOINT,
    OBJECT_STORAGE_ACCESS_KEY: source.OBJECT_STORAGE_ACCESS_KEY,
    OBJECT_STORAGE_SECRET_KEY: source.OBJECT_STORAGE_SECRET_KEY,
    OBJECT_STORAGE_BUCKET: source.OBJECT_STORAGE_BUCKET,
    OBJECT_STORAGE_REGION: source.OBJECT_STORAGE_REGION,
    // The browser frontend runs at :3010 in every local topology; a
    // deployment overrides this with its own origins. A default keeps
    // development working without every operator setting it, the same way
    // GATEWAY_INSTANCE_ID and REPLY_TIMEOUT_MS carry theirs.
    CORS_ALLOWED_ORIGINS: source.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3010',
    // An empty string is how an unset Secret reaches a container: absent, not a token.
    ALERT_WEBHOOK_TOKEN: source.ALERT_WEBHOOK_TOKEN === '' ? undefined : source.ALERT_WEBHOOK_TOKEN,
    INTERBANK_PARTNER_TOKEN:
      source.INTERBANK_PARTNER_TOKEN === '' ? undefined : source.INTERBANK_PARTNER_TOKEN,
    INTERBANK_API_KEY_INBOUND:
      source.INTERBANK_API_KEY_INBOUND === '' ? undefined : source.INTERBANK_API_KEY_INBOUND,
    INTERBANK_PARTNERS: source.INTERBANK_PARTNERS === '' ? undefined : source.INTERBANK_PARTNERS,
    INTERBANK_BANK_CODE: source.INTERBANK_BANK_CODE ?? 'BANK02',
    INTERBANK_PARTNER_BANK_CODE: source.INTERBANK_PARTNER_BANK_CODE ?? 'BANK99',
    INTERBANK_MAX_AMOUNT_MINOR: toInteger(source.INTERBANK_MAX_AMOUNT_MINOR) ?? V1_MAX_AMOUNT_MINOR,
  });

  const errors = validateSync(candidate, { skipMissingProperties: false, whitelist: true });
  if (errors.length > 0) {
    const variables = errors.map((error) => error.property);
    const details = errors
      .map((error) => `  - ${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`)
      .join('\n');
    throw new EnvironmentValidationError(variables, details);
  }

  return candidate;
}

/** `undefined` when absent, `NaN` when present but not an integer. */
function toInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}
