import type { Role } from '../../../app/lib/navigation';

/**
 * A token shaped exactly the way `app/lib/session.ts#decodeSession` reads
 * one — three dot-separated segments, the middle one base64url JSON carrying
 * `sub`, `username`, `role`, `exp`.
 *
 * The header and signature are not real, and `decodeSession` never checks
 * them: "Verification happens in the Gateway... a browser cannot keep a
 * signing key" (its own doc comment). This suite is testing what the
 * **browser** does with a session it trusts, the same way the real client
 * does — it is not a claim that this token would pass the Gateway.
 */
export function fakeToken(claims: {
  readonly sub: string;
  readonly username: string;
  readonly role: Role;
  readonly expiresInSeconds?: number;
}): string {
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: claims.sub,
      username: claims.username,
      role: claims.role,
      exp: Math.floor(Date.now() / 1000) + (claims.expiresInSeconds ?? 3600),
    }),
  );

  return `${header}.${payload}.not-a-real-signature`;
}

function base64url(json: string): string {
  return Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
