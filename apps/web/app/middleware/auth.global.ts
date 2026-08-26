import { canOpen } from '../lib/navigation';

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
  const { session, role } = useSession();

  if (canOpen(role.value, to.path)) {
    return;
  }

  return session.value === null
    ? navigateTo({ path: '/login', query: { next: to.fullPath } })
    : navigateTo('/');
});
