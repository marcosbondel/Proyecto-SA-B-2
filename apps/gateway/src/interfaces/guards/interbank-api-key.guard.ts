import { createHash, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { GatewayError } from '../../application/errors/gateway-error';
import type { GatewayRequest } from '../http-request';

/**
 * El mapa de API keys del contrato oficial: **una clave por banco pareja**.
 *
 * La clave `X-Api-Key` no sólo autentica, **identifica al banco que llama** —
 * lo dice el contrato, y de ahí cuelgan dos reglas suyas que sin esta
 * identificación no se pueden cumplir: que «un banco sólo puede consultar,
 * cancelar o recibir callbacks de transferencias en las que participa», y que
 * la conciliación devuelva «los depósitos que este banco recibió **del banco
 * que consulta**».
 *
 * Un token compartido no sirve para eso. El anterior
 * (`InterbankTokenGuard`, con `Authorization: Bearer`) autenticaba y no decía
 * quién: con dos parejas, cualquiera habría podido consultar las
 * transferencias de la otra.
 */
export const INTERBANK_API_KEYS = Symbol('InterbankApiKeys');

/** Lo que una clave válida identifica. */
export interface InterbankCaller {
  readonly bankCode: string;
}

@Injectable()
export class InterbankApiKeyGuard implements CanActivate {
  /** Resumen de la clave → el banco que la tiene. */
  readonly #porClave: readonly { readonly huella: Buffer; readonly bankCode: string }[];

  constructor(@Inject(INTERBANK_API_KEYS) claves: Readonly<Record<string, string>>) {
    this.#porClave = Object.entries(claves)
      .filter(([bankCode, clave]) => bankCode.length > 0 && clave.length > 0)
      .map(([bankCode, clave]) => ({
        huella: createHash('sha256').update(clave).digest(),
        bankCode,
      }));
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GatewayRequest>();
    const presentada = request.headers['x-api-key'];
    const clave = typeof presentada === 'string' ? presentada : null;

    if (clave === null || clave.length === 0 || this.#porClave.length === 0) {
      throw GatewayError.unauthenticated('API key interbancaria ausente o no configurada.');
    }

    const huella = createHash('sha256').update(clave).digest();
    /*
     * Se comparan **todas** las claves y no se corta en la primera que coincide.
     * Con un `find` el tiempo de respuesta diría en qué posición de la lista
     * está la clave de cada banco, que es una fuga pequeña pero gratuita de
     * evitar — y `timingSafeEqual` ya existe precisamente para no regalar esa
     * clase de información.
     */
    let encontrado: string | null = null;
    for (const candidato of this.#porClave) {
      if (timingSafeEqual(candidato.huella, huella)) {
        encontrado = candidato.bankCode;
      }
    }

    if (encontrado === null) {
      throw GatewayError.unauthenticated('API key interbancaria no válida.');
    }

    /*
     * Quién llamó se deja en la petición: las rutas lo necesitan para cumplir
     * las dos reglas del contrato que dependen de la identidad, y volver a
     * resolverlo en cada controlador sería resolverlo dos veces.
     */
    (request as GatewayRequest & { interbankCaller?: InterbankCaller }).interbankCaller = {
      bankCode: encontrado,
    };

    return true;
  }
}
