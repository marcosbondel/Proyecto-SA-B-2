import { JwtService } from '@nestjs/jwt';
import type { Identity, Role } from '@bank/contracts';
import { role as roleSchema } from '@bank/contracts';

import { GatewayError } from '../../application/errors/gateway-error';

/** What Customer Service decided about who this is. */
export interface SessionClaims {
  readonly customerId: string;
  readonly username: string;
  readonly role: Role;
}

interface TokenPayload {
  readonly sub: string;
  readonly username: string;
  readonly role: string;
}

export interface SessionTokenSettings {
  readonly secret: string;
  readonly expiresInSeconds: number;
}

/**
 * Signs and verifies the session token — the only component in the system that
 * does either.
 *
 * HS256 is defensible precisely because of that. The usual argument for
 * asymmetric signing is that a component which validates should not be able to
 * forge; here signing and validation are the same component, so there is
 * nothing for that argument to bite on and the secret never leaves the process
 * (ADR-010).
 *
 * There is **no revocation**. A compromised token is valid until it expires,
 * which is why it expires in an hour and why there is no refresh.
 */
export class SessionTokenService {
  readonly #jwt: JwtService;
  readonly #expiresInSeconds: number;

  constructor(settings: SessionTokenSettings) {
    this.#expiresInSeconds = settings.expiresInSeconds;
    this.#jwt = new JwtService({
      secret: settings.secret,
      signOptions: { algorithm: 'HS256', expiresIn: settings.expiresInSeconds },
      verifyOptions: { algorithms: ['HS256'] },
    });
  }

  public get expiresInSeconds(): number {
    return this.#expiresInSeconds;
  }

  /**
   * Mints a token over claims another service decided.
   *
   * The gateway never determines *whether* the credential was valid — it only
   * packages the verdict. That is what keeps this authentication rather than a
   * domain decision (constitution V).
   */
  public sign(claims: SessionClaims): string {
    const payload: TokenPayload = {
      sub: claims.customerId,
      username: claims.username,
      role: claims.role,
    };

    return this.#jwt.sign(payload);
  }

  /**
   * Verifies signature and expiry and returns the identity that will travel in
   * the message envelope.
   *
   * Every failure collapses to the same rejection. Distinguishing "expired"
   * from "forged" would tell an attacker which half of their guess was right.
   */
  public verify(token: string): Identity & { readonly username: string } {
    let payload: TokenPayload;
    try {
      payload = this.#jwt.verify<TokenPayload>(token);
    } catch {
      throw GatewayError.unauthenticated('Sesión no válida o expirada.');
    }

    const parsedRole = roleSchema.safeParse(payload.role);
    if (!parsedRole.success || typeof payload.sub !== 'string') {
      // A well-signed token carrying a role this system does not define means
      // the secret is shared with something that should not have it.
      throw GatewayError.unauthenticated('Sesión no válida o expirada.');
    }

    return { customerId: payload.sub, role: parsedRole.data, username: payload.username };
  }
}
