/**
 * Internal protocol shared by TaggedError and createTaggedError classes so
 * either kind can extend the other.
 */

/**
 * Marks classes built by TaggedError or createTaggedError. Symbol.for keeps
 * detection working when the ESM and CommonJS builds are both loaded.
 */
export const TAGGED_CLASS: unique symbol = Symbol.for(
  '@spotsccc/error-as-value/tagged-class',
)

/**
 * Args key a tagged subclass uses to hand its final message and options to a
 * tagged base, so only the outermost class handles message, name and stack.
 */
export const FORWARDED_SUPER: unique symbol = Symbol.for(
  '@spotsccc/error-as-value/forwarded-super',
)

export type ForwardedSuper = {
  readonly message: string
  readonly options: { cause: unknown } | undefined
}

/** Reads the forwarded message/options, if a tagged subclass sent them. */
export const readForwarded = (args: unknown): ForwardedSuper | undefined =>
  typeof args === 'object' && args !== null
    ? ((args as Record<PropertyKey, unknown>)[FORWARDED_SUPER] as
        | ForwardedSuper
        | undefined)
    : undefined

export const isTaggedClass = (Base: Function): boolean => TAGGED_CLASS in Base
