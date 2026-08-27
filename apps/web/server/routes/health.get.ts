/**
 * Liveness. Answers while the Nitro process is alive, and reports on nothing
 * else.
 *
 * A liveness probe exists to catch a process that has stopped serving —
 * deadlocked, out of memory, wedged in an infinite loop. If this route answers,
 * none of those is true, and there is nothing a restart would improve. So it
 * deliberately never checks the Gateway: an interface that restarted itself
 * every time the API was briefly unreachable would be down twice as often as
 * the API.
 */
export default defineEventHandler(() => ({
  status: 'ok' as const,
  application: 'web',
}));
