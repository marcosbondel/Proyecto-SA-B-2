import { jestBaseConfig } from '@bank/tooling/jest.base.mjs';

export default {
  ...jestBaseConfig,
  /**
   * One worker, because this service has two integration suites that share one
   * database and each empties its tables before every case (T-45 added the
   * second). Jest runs spec files in parallel by default, and in parallel one
   * suite's `TRUNCATE` lands in the middle of the other's assertions: red in a
   * way that depends on timing. `payment-service` met the same thing in T-44 and
   * paid the same price. The whole suite takes seconds, so serialising it costs
   * nothing that matters.
   */
  maxWorkers: 1,
};
