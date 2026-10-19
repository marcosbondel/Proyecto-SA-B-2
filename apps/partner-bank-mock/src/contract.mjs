/**
 * El contrato interbancario oficial, aplicado.
 *
 * Los esquemas no se escriben aquí: se leen de `contract-schemas.json`, que
 * `scripts/sync-contract.mjs` genera del YAML del curso y que una prueba compara
 * con él en cada corrida. Lo que sí vive aquí es el validador mínimo —el
 * subconjunto de OpenAPI 3.0 / JSON Schema que el contrato usa— y los pequeños
 * hechos del contrato que no son un esquema: los siete motivos, los 180 s, el
 * máximo de Q10 000,00 y la forma del cuerpo de error.
 *
 * Una advertencia que el contrato hace y que este validador respeta: sólo
 * `TransferRequest` y `TransferResult` declaran `additionalProperties: false`.
 * Un `CancelRequest` con un campo de más **es válido**, y rechazarlo sería
 * modificar el contrato por cuenta propia.
 */
import { readFileSync } from 'node:fs';

const document = JSON.parse(
  readFileSync(new URL('./contract-schemas.json', import.meta.url), 'utf8'),
);

export const SCHEMAS = document.schemas;
/** SHA-256 del YAML oficial del que salieron los esquemas. */
export const CONTRACT_SHA256 = document.sha256;

export const REASON_CODES = SCHEMAS.ReasonCode.enum;
/** Vigencia de un depósito: `expiresAt = createdAt + 180 s`. */
export const TRANSFER_TTL_MS = 180_000;
/** Máximo por operación que fija el contrato, en centavos. */
export const MAX_AMOUNT_MINOR = 1_000_000;
export const MIN_AMOUNT_MINOR = 1;

export const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

export function isDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE.exec(value);
  if (match === null) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function isDateTime(value) {
  return DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

const FORMATS = {
  uuid: isUuid,
  'date-time': isDateTime,
  date: isDate,
};

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(expected, value) {
  const actual = typeOf(value);
  return actual === expected || (expected === 'number' && actual === 'integer');
}

function resolve(schema) {
  if (typeof schema.$ref !== 'string') return schema;
  const name = schema.$ref.replace('#/components/schemas/', '');
  const target = SCHEMAS[name];
  if (target === undefined) throw new Error(`Esquema desconocido: ${schema.$ref}`);
  return resolve(target);
}

function check(schema, value, path, errors) {
  const node = resolve(schema);

  if (node.type !== undefined && !typeMatches(node.type, value)) {
    errors.push(`${path}: debe ser ${node.type}`);
    return;
  }
  if (node.enum !== undefined && !node.enum.includes(value)) {
    errors.push(`${path}: debe ser uno de ${node.enum.join(', ')}`);
  }
  if (typeof value === 'string') {
    if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) {
      errors.push(`${path}: no cumple el patrón ${node.pattern}`);
    }
    if (node.maxLength !== undefined && value.length > node.maxLength) {
      errors.push(`${path}: excede ${node.maxLength} caracteres`);
    }
    const format = FORMATS[node.format];
    if (format !== undefined && !format(value)) {
      errors.push(`${path}: no es un ${node.format} válido`);
    }
  }
  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum)
      errors.push(`${path}: menor que ${node.minimum}`);
    if (node.maximum !== undefined && value > node.maximum)
      errors.push(`${path}: mayor que ${node.maximum}`);
  }
  if (Array.isArray(value) && node.items !== undefined) {
    value.forEach((item, index) => check(node.items, item, `${path}[${index}]`, errors));
  }
  if (typeOf(value) === 'object') {
    for (const name of node.required ?? []) {
      if (!(name in value)) errors.push(`${path}.${name}: es obligatorio`);
    }
    const properties = node.properties ?? {};
    for (const [name, child] of Object.entries(value)) {
      if (name in properties) check(properties[name], child, `${path}.${name}`, errors);
      else if (node.additionalProperties === false)
        errors.push(`${path}.${name}: campo no permitido`);
    }
  }
}

/** Valida `value` contra `components.schemas[name]`. Devuelve la lista de problemas (vacía si es válido). */
export function validate(name, value) {
  const schema = SCHEMAS[name];
  if (schema === undefined) throw new Error(`Esquema desconocido: ${name}`);
  const errors = [];
  check(schema, value, '$', errors);
  return errors;
}

/** El cuerpo de error del contrato (`Error`): `{ code, message, timestamp }`. */
export function errorBody(code, message, now = new Date()) {
  return { code, message, timestamp: now.toISOString() };
}

/** `"150.00"` → `15000`. El contrato garantiza el patrón; aquí sólo se convierte. */
export function toMinor(amount) {
  const [whole, cents] = amount.split('.');
  return Number(whole) * 100 + Number(cents);
}

/** `15000` → `"150.00"`. */
export function fromMinor(minor) {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

/** Una igualdad de contenido que no depende del orden de las claves. */
export function sameContent(a, b) {
  return canonical(a) === canonical(b);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
