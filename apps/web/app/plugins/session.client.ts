/**
 * Rehydrates the session from `sessionStorage` before anything routes.
 *
 * Client-only (`.client.ts`), and it runs during app creation — ahead of the
 * route middleware — so that on a full reload the session is already in place
 * when `auth.global.ts` decides what may open. Without it the middleware would
 * see an empty session and bounce a signed-in visitor to `/login` on every F5.
 */
export default defineNuxtPlugin(() => {
  useSession().restore();
});
