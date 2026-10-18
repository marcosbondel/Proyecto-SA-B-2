import { jestBaseConfig } from '@bank/tooling/jest.base.mjs';

export default {
  ...jestBaseConfig,
  /**
   * One worker, because this service has two integration suites that share one
   * database and each empties its tables before every case (TD-086). Jest runs
   * spec files in parallel by default, and in parallel one suite's `TRUNCATE`
   * lands in the middle of another's assertions: red in a way that depends on
   * timing. `payment-service` and `notification-audit-service` already do the
   * same. The whole suite takes seconds, so serialising it costs nothing that
   * matters, and it changes how many cases run by exactly zero.
   */
  maxWorkers: 1,
};
