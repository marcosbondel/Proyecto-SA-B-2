import type { z } from 'zod';

import type { Producer } from '../schemas/primitives';
import { messageTypeName } from '../schemas/primitives';

/**
 * What kind of statement a message makes.
 *
 * The distinction is not bookkeeping: it decides how many handlers a message
 * may have, and which exchange carries it.
 */
export type Category = 'command' | 'event' | 'reply';

/** One message: its name, who says it, who listens, and what it must look like. */
export interface MessageContract<TSchema extends z.ZodType = z.ZodType> {
  /** Full name including the version suffix. Also the routing key. */
  readonly name: string;
  readonly category: Category;
  readonly producer: Producer;
  /** Who consumes it. A reply lists only the application that asked. */
  readonly consumers: readonly Producer[];
  readonly schema: TSchema;
}

/**
 * Registers a contract, refusing at module load anything that breaks the rules
 * `docs/domain/message-catalog.md` states.
 *
 * Throwing here rather than in a test is deliberate: a malformed catalogue
 * should not be importable at all, so no service can build against one.
 */
export function defineContract<TSchema extends z.ZodType>(
  contract: MessageContract<TSchema>,
): MessageContract<TSchema> {
  if (!messageTypeName.safeParse(contract.name).success) {
    throw new Error(
      `Contract "${contract.name}" has no version suffix; expected a name ending in .vN.`,
    );
  }

  // A command expresses an intention aimed at one service (invariant C-1).
  if (contract.category === 'command' && contract.consumers.length !== 1) {
    throw new Error(
      `Command "${contract.name}" declares ${String(contract.consumers.length)} handlers; a command has exactly one.`,
    );
  }

  // An event narrates something that happened; nobody listening means nobody
  // needed it said (invariant C-2, "no orphan events").
  if (contract.category === 'event' && contract.consumers.length === 0) {
    throw new Error(`Event "${contract.name}" has no consumer; orphan events are forbidden.`);
  }

  // A reply is addressed to whoever asked, and to nobody else (invariant C-3).
  if (contract.category === 'reply' && contract.consumers.length !== 1) {
    throw new Error(
      `Reply "${contract.name}" declares ${String(contract.consumers.length)} recipients; a reply answers exactly one asker.`,
    );
  }

  if (contract.consumers.includes(contract.producer)) {
    throw new Error(`Contract "${contract.name}" lists its own producer as a consumer.`);
  }

  return contract;
}
