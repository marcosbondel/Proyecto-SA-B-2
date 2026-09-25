import { asyncStateFor } from '../lib/gateway-error';
import type { ScreenState } from '../lib/gateway-error';
import type { InboxNotification } from '../lib/audit';

/**
 * The signed-in person's notifications, shared between the header's bell and
 * the inbox screen.
 *
 * One `useState` key and not two, which is the whole reason this is a
 * composable: marking everything read on `/notificaciones` has to empty the
 * badge in the header, and a bell with its own copy of the count would keep
 * showing a number that is no longer true until the next page load.
 *
 * It fetches **once** unless asked again. The bell is mounted on every screen,
 * so a fetch on mount would be a request per navigation for a number that
 * changes when an event arrives — which no screen here is told about anyway.
 */
export function useInbox() {
  const api = useGatewayApi();
  const { isSignedIn, role, session } = useSession();

  const notifications = useState<readonly InboxNotification[]>('bank-inbox', () => []);
  const unread = useState<number>('bank-inbox-unread', () => 0);
  const state = useState<ScreenState>('bank-inbox-state', () => 'IDLE');
  const failure = useState<string | null>('bank-inbox-failure', () => null);

  function reset(): void {
    notifications.value = [];
    unread.value = 0;
    state.value = 'IDLE';
    failure.value = null;
  }

  // Clear unread count and inbox state whenever the active session or username changes
  watch(
    () => session.value?.username,
    () => {
      reset();
    },
  );

  async function load(limit = 30): Promise<void> {
    if (!isSignedIn.value || role.value !== 'CLIENTE') {
      reset();
      return;
    }

    state.value = 'LOADING';
    failure.value = null;

    const result = await api.call<{
      notifications: InboxNotification[];
      unread: number;
    }>('/api/notifications', { query: { limit: String(limit) } });

    if (result.ok) {
      notifications.value = result.data.notifications;
      unread.value = result.data.unread;
      state.value = 'READY';
      return;
    }

    failure.value = result.error.message;
    state.value = asyncStateFor(result.error);
  }

  /** Fetches only if nothing has been fetched yet and user is a client. What the bell calls. */
  async function loadOnce(): Promise<void> {
    if (role.value !== 'CLIENTE') {
      reset();
      return;
    }
    if (state.value === 'IDLE') {
      await load();
    }
  }

  /**
   * Marks everything, or the ones named, as read.
   *
   * The new unread count comes back from the write, so the badge is redrawn
   * from what the service said rather than from arithmetic here — a local
   * decrement would drift the moment two tabs did this at once.
   */
  async function markRead(notificationIds?: readonly string[]): Promise<boolean> {
    const result = await api.call<{ changed: number; unread: number }>(
      '/api/notifications/read',
      {
        method: 'POST',
        body: notificationIds === undefined ? {} : { notificationIds: [...notificationIds] },
      },
    );

    if (!result.ok) {
      failure.value = result.error.message;
      return false;
    }

    unread.value = result.data.unread;

    const now = new Date().toISOString();

    notifications.value = notifications.value.map((notification) =>
      (notificationIds === undefined || notificationIds.includes(notification.notificationId)) &&
      notification.readAt === null
        ? { ...notification, readAt: now }
        : notification,
    );

    return true;
  }

  return { notifications, unread, state, failure, load, loadOnce, markRead, reset };
}
