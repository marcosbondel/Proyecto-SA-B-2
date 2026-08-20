/**
 * How an amount of money is written on the wire.
 *
 * A transport shape and nothing more: no arithmetic, no rounding policy, no
 * currency rules. Whoever owns the data decides what an amount may be; this
 * only fixes how it is spelled so seven applications spell it the same way.
 *
 * The runtime schema lives in `../schemas/primitives` as `money`; this is the
 * type by another name, kept so consumers that only need the shape do not have
 * to reach into the schema module.
 */
export type { Money as MoneyDto } from '../schemas/primitives';
