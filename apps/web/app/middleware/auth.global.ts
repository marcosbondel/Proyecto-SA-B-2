import { canOpen, isGuestOnly } from '../lib/navigation';

/**
 * Decides what a visitor may open, before anything renders.
 *
 * **This is convenience, not security.** It exists so the interface never shows
 * a screen whose every request would be refused. The prohibition itself is the
 * Gateway's, and the Gateway applies it whether or not this file ran — which is
 * exactly why the test that proves authorization calls the API directly,
 * without a browser.
 *
 * The redirect for a role that may not open a route goes to the signed-in
 * landing page rather than to sign-in: the visitor is not anonymous, they are
 * simply somewhere that is not theirs, and sending them to a login form they
 * have already completed would be a loop with no exit.
 */
export default defineNuxtRouteMiddleware((to) => {
  /**
   * The session lives in the browser (`sessionStorage`, rehydrated by
   * `plugins/session.client.ts`), so on the server it is always empty and a
   * check here would bounce every signed-in visitor to `/login` on a reload.
   * Deciding on the client is safe precisely because this is convenience, not
   * the boundary — the Gateway refuses regardless of what ran here.
   */
  if (import.meta.server) {
    return;
  }

  const { session, role } = useSession();

  /**
   * The guard's other direction: a signed-in visitor has no business on the
   * sign-in or registration form. They are not refused anything — they are
   * already past those doors — so they land on the signed-in landing page,
   * for the same reason the role redirect below goes there and not to a login
   * form they have already completed.
   */
  if (session.value !== null && isGuestOnly(to.path)) {
    return navigateTo('/');
  }

  if (canOpen(role.value, to.path)) {
    return;
  }

  return session.value === null
    ? navigateTo({ path: '/login', query: { next: to.fullPath } })
    : navigateTo('/');
});
