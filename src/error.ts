import { serializeCause } from './serialize-cause.js'
import type { NarrowErrors } from './types.js'
import {
  FORWARDED_SUPER,
  TAGGED_CLASS,
  isTaggedClass,
  readForwarded,
  type ForwardedSuper,
} from './tagged-protocol.js'

/**
 * Any class that extends Error (used by findCause)
 */
type AnyErrorClass = new (...args: any[]) => Error

/**
 * Walk the .cause chain of an error to find an ancestor matching a specific error class.
 * Checks the error itself first, then traverses .cause recursively.
 * Similar to Go's `errors.As`.
 *
 * @example
 * const notFound = findCause(err, NotFoundError)
 * if (notFound) {
 *   console.log(notFound.id) // type-safe access
 * }
 *
 * @example
 * // With optional chaining
 * const id = findCause(err, NotFoundError)?.id
 */
export function findCause<T extends Error>(
  error: Error,
  ErrorClass: abstract new (...args: any[]) => T,
): T | undefined {
  const seen = new Set<Error>()
  let current: unknown = error
  while (current instanceof Error) {
    if (seen.has(current)) break
    seen.add(current)
    if (current instanceof ErrorClass) return current as T
    current = current.cause
  }
  return undefined
}

/**
 * Any tagged error (for generic constraints)
 */
type AnyTaggedError = Error & { readonly _tag: string }

/**
 * Type guard for any tagged error
 */
const isAnyTaggedError = (value: unknown): value is AnyTaggedError => {
  return (
    value instanceof Error && '_tag' in value && typeof value._tag === 'string'
  )
}

/**
 * Any class that extends Error
 */
type ErrorClass = new (...args: any[]) => Error

/**
 * Members a tagged base redefines; dropped from a literal-tagged base so the
 * subclass's own `_tag` does not intersect with it into never.
 */
type TaggedOwnKeys = '_tag' | 'messageTemplate' | 'fingerprint'

/**
 * The base's contribution to a TaggedError instance type. A tagged base (from
 * either factory) loses its tagged members: a TaggedError's `fingerprint` is
 * `[tag]`, which conflicts with a createTaggedError base's `[tag, template]`
 * even when that base is extendable. Any other Error class is kept as is.
 */
type TaggedBaseInstance<Base extends Error> = Base extends {
  readonly _tag: string
}
  ? Omit<Base, TaggedOwnKeys> & Error
  : Base

/**
 * Instance type produced by TaggedError factory
 */
export type TaggedErrorInstance<
  Tag extends string,
  Props,
  Base extends Error = Error,
> = TaggedBaseInstance<Base> & {
  readonly _tag: Tag
  /** Stable fingerprint for error grouping in Sentry/logging. Returns [_tag]. */
  readonly fingerprint: readonly [Tag]
  toJSON(): object
  /** Walk the .cause chain to find an ancestor matching a specific error class. */
  findCause<T extends Error>(
    ErrorClass: abstract new (...args: any[]) => T,
  ): T | undefined
} & Readonly<Props>

/**
 * Class type produced by TaggedError factory
 */
export type TaggedErrorClass<
  Tag extends string,
  Props,
  Base extends Error = Error,
> = {
  new (
    ...args: keyof Props extends never ? [args?: {}] : [args: Props]
  ): TaggedErrorInstance<Tag, Props, Base>
  /** Type guard for this error class */
  is(value: unknown): value is TaggedErrorInstance<Tag, Props, Base>
}

/**
 * Factory for tagged error classes with discriminated _tag property.
 * Enables exhaustive pattern matching on error unions.
 *
 * @example
 * class NotFoundError extends TaggedError("NotFoundError")<{
 *   id: string;
 *   message: string;
 * }>() {}
 *
 * const err = new NotFoundError({ id: "123", message: "Not found" });
 * err._tag    // "NotFoundError"
 * err.id      // "123"
 *
 * // Type guard
 * NotFoundError.is(err) // true
 * TaggedError.is(err)   // true (any tagged error)
 *
 * @example
 * // With custom base class
 * class AppError extends Error {
 *   statusCode: number = 500
 *   report() { console.log(this.message) }
 * }
 *
 * class NotFoundError extends TaggedError("NotFoundError", AppError)<{
 *   id: string;
 *   message: string;
 * }>() {
 *   statusCode = 404
 * }
 *
 * const err = new NotFoundError({ id: "123", message: "Not found" });
 * err.statusCode // 404
 * err.report()   // works
 */
export const TaggedError: {
  <Tag extends string, BaseClass extends ErrorClass = typeof Error>(
    tag: Tag,
    BaseClass?: BaseClass,
  ): <Props extends Record<string, unknown> = {}>() => TaggedErrorClass<
    Tag,
    Props,
    InstanceType<BaseClass>
  >
  /** Type guard for any TaggedError instance */
  is(value: unknown): value is AnyTaggedError
} = Object.assign(
  <Tag extends string, BaseClass extends ErrorClass = typeof Error>(
    tag: Tag,
    BaseClass?: BaseClass,
  ) =>
    <Props extends Record<string, unknown> = {}>(): TaggedErrorClass<
      Tag,
      Props,
      InstanceType<BaseClass>
    > => {
      const ActualBase = (BaseClass ?? Error) as typeof Error

      // Keys that are managed internally and must not be overwritten by user props
      const RESERVED_KEYS = new Set([
        '_tag',
        'fingerprint',
        'name',
        'stack',
        'message',
        'cause',
      ])

      // A tagged base (either factory) expects an args object, not (message, options).
      const baseIsTagged = isTaggedClass(ActualBase)

      class Tagged extends ActualBase {
        readonly _tag: Tag = tag

        get fingerprint(): readonly [Tag] {
          return [this._tag]
        }

        static readonly [TAGGED_CLASS] = true

        /** Type guard for this error class */
        static is(value: unknown): value is Tagged {
          return value instanceof Tagged
        }

        constructor(args?: Props) {
          // When a tagged subclass constructs us, it owns message, name and
          // stack: only forward to our own base and assign our props.
          const forwarded = readForwarded(args)
          const message = forwarded
            ? forwarded.message
            : args && 'message' in args && typeof args.message === 'string'
              ? args.message
              : undefined
          const cause = forwarded
            ? forwarded.options?.cause
            : args && 'cause' in args
              ? args.cause
              : undefined
          const options = forwarded
            ? forwarded.options
            : cause !== undefined
              ? { cause }
              : undefined

          if (baseIsTagged) {
            const forward: ForwardedSuper = { message: message ?? '', options }
            super({ ...args, cause, [FORWARDED_SUPER]: forward } as never)
          } else {
            super(message, options)
          }

          if (args) {
            for (const key of Object.keys(args)) {
              if (!RESERVED_KEYS.has(key)) {
                ;(this as Record<string, unknown>)[key] = (
                  args as Record<string, unknown>
                )[key]
              }
            }
          }

          if (forwarded) return

          Object.setPrototypeOf(this, new.target.prototype)
          this.name = tag

          if (cause instanceof Error && cause.stack) {
            const indented = cause.stack.replace(/\n/g, '\n  ')
            this.stack = `${this.stack}\nCaused by: ${indented}`
          }
        }

        findCause<T extends Error>(
          ErrorClass: abstract new (...args: any[]) => T,
        ): T | undefined {
          return findCause(this, ErrorClass)
        }

        toJSON(): object {
          return {
            ...this,
            _tag: this._tag,
            name: this.name,
            message: this.message,
            fingerprint: this.fingerprint,
            cause: serializeCause(this.cause),
            stack: this.stack,
          }
        }
      }

      return Tagged as unknown as TaggedErrorClass<
        Tag,
        Props,
        InstanceType<BaseClass>
      >
    },
  { is: isAnyTaggedError },
)

/**
 * Type guard for tagged error instances.
 *
 * @example
 * if (isTaggedError(value)) { value._tag }
 */
export const isTaggedError = isAnyTaggedError

/**
 * Literal `_tag`s of the members of E. An error whose `_tag` is `string` (an
 * extendable base) has no fixed tag to match on, so it goes to `Error`.
 * (Written without `infer`, which breaks contextual typing of the handlers.)
 */
type LiteralTags<E> = E extends AnyTaggedError
  ? string extends E['_tag']
    ? never
    : E['_tag']
  : never

/**
 * Handler map with required `Error` fallback for untagged errors and
 * extendable bases.
 */
type MatchHandlersWithPlain<E extends Error, R> = {
  [K in LiteralTags<E>]: (err: Extract<E, { readonly _tag: K }>) => R
} & {
  Error: (
    err: Exclude<E, { readonly _tag: LiteralTags<E> }> extends never
      ? Error
      : Exclude<E, { readonly _tag: LiteralTags<E> }>,
  ) => R
}

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key)

/**
 * Handler registered for err's `_tag`. Own keys only, so tags such as
 * `constructor` or `toString` never resolve to Object.prototype members.
 */
const taggedHandler = <R>(
  handlers: Record<string, (e: Error) => R>,
  err: Error,
): ((e: Error) => R) | undefined => {
  if (!('_tag' in err) || typeof err._tag !== 'string') return undefined
  return hasOwn(handlers, err._tag) ? handlers[err._tag] : undefined
}

/**
 * Exhaustive pattern match on error union by _tag.
 * The `Error` handler is always required as fallback for plain Error instances.
 *
 * @example
 * const message = matchError(err, {
 *   NotFoundError: (e) => `Missing: ${e.id}`,
 *   ValidationError: (e) => `Invalid: ${e.field}`,
 *   Error: (e) => `Unknown error: ${e.message}`,
 * });
 */
export function matchError<E extends Error, R>(
  err: E,
  handlers: MatchHandlersWithPlain<E, R>,
): R {
  const h = handlers as unknown as Record<string, (e: Error) => R>
  const handler = taggedHandler(h, err)
  if (handler) {
    return handler(err)
  }
  // Fall through to Error handler for plain Error or unknown tagged errors
  return h['Error']!(err)
}

/**
 * Partial pattern match with fallback for unhandled tags.
 *
 * @example
 * const message = matchErrorPartial(err, {
 *   NotFoundError: (e) => `Missing: ${e.id}`,
 * }, (e) => `Unknown: ${e.message}`);
 */
export function matchErrorPartial<E extends Error, R>(
  err: E,
  handlers: Partial<MatchHandlersWithPlain<E, R>>,
  fallback: (e: E) => R,
): R {
  const h = handlers as unknown as Record<string, (e: Error) => R>
  const handler = taggedHandler(h, err)
  if (handler) {
    return handler(err)
  }
  // Check for Error handler before fallback
  const errorHandler = hasOwn(h, 'Error') ? h['Error'] : undefined
  if (errorHandler) {
    return errorHandler(err)
  }
  return fallback(err)
}

/**
 * Base class for abort-related errors.
 * Extend this in custom abort errors so `isAbortError` detects them
 * even when wrapped in a cause chain.
 *
 * @example
 * import { AbortError, createTaggedError } from '@spotsccc/error-as-value'
 *
 * class TimeoutError extends createTaggedError({
 *   name: 'TimeoutError',
 *   message: 'Request timed out for $operation',
 *   extends: AbortError,
 * }) {}
 *
 * controller.abort(new TimeoutError({ operation: 'fetch' }))
 */
export class AbortError extends Error {
  constructor(message = 'The operation was aborted', options?: ErrorOptions) {
    super(message, options)
    this.name = 'AbortError'
  }
}

/**
 * Type-only brand for the true branch of isAbortError/isTimeoutError. The
 * predicate type is a strict subtype of the error, so the false branch keeps
 * errors that are not aborts/timeouts instead of excluding every Error.
 */
declare const causeBrand: unique symbol
type CauseBrand<Kind extends string> = { readonly [causeBrand]: Kind }

/** An error whose `.cause` chain contains an abort. */
export type AbortCaused = CauseBrand<'abort'>

/** An error whose `.cause` chain contains a timeout. */
export type TimeoutCaused = CauseBrand<'timeout'>

/** Walk `.cause` (cycle-safe) and test each Error. */
const someInCauseChain = (
  error: unknown,
  test: (e: Error) => boolean,
): boolean => {
  const seen = new Set<Error>()
  let current: unknown = error
  while (current instanceof Error) {
    if (seen.has(current)) break
    seen.add(current)
    if (test(current)) return true
    current = current.cause
  }
  return false
}

/**
 * Check if an error (or any error in its `.cause` chain) is an abort error.
 * Detects native AbortError (DOMException), this package's AbortError, and any
 * tagged error that extends it.
 *
 * Narrows one-sidedly: the true branch is the error side of the input (marked
 * `AbortCaused`); the false branch keeps every member, because a non-abort
 * error can still be there.
 *
 * Does not match the `TimeoutError` DOMException that `AbortSignal.timeout()`
 * produces; use `isTimeoutError` for that.
 *
 * @example
 * import { isAbortError } from '@spotsccc/error-as-value'
 *
 * const res = await fetch(url, { signal })
 *   .catch((e) => new NetworkError({ url, cause: e }))
 * if (isAbortError(res)) {
 *   // request was aborted — user cancel, controller.abort(), etc.
 * }
 */
export function isAbortError<V>(
  error: V,
): error is NarrowErrors<V> & AbortCaused {
  return someInCauseChain(
    error,
    // Native DOMException AbortError or direct AbortError (name = 'AbortError'),
    // or a tagged error extending AbortError (createTaggedError sets name to _tag)
    (e) => e.name === 'AbortError' || e instanceof AbortError,
  )
}

/**
 * Check if an error (or any error in its `.cause` chain) is a timeout: the
 * `TimeoutError` DOMException that `AbortSignal.timeout(ms)` aborts fetch
 * with, or any error named `TimeoutError`. Narrows one-sidedly, like
 * isAbortError.
 *
 * @example
 * const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
 *   .catch((e) => new NetworkError({ url, cause: e }))
 * if (isTimeoutError(res)) return new UpstreamTimeoutError({ url, cause: res })
 * if (isAbortError(res)) return 'cancelled'
 * if (res instanceof Error) return res
 */
export function isTimeoutError<V>(
  error: V,
): error is NarrowErrors<V> & TimeoutCaused {
  return someInCauseChain(error, (e) => e.name === 'TimeoutError')
}

/**
 * Default error type when catching unknown exceptions.
 */
export class UnhandledError extends TaggedError('UnhandledError')<{
  message: string
  cause: unknown
}>() {
  constructor(args: { cause: unknown }) {
    const message =
      args.cause instanceof Error
        ? `Unhandled exception: ${args.cause.message}`
        : `Unhandled exception: ${String(args.cause)}`
    // Spread args so a tagged subclass's forwarded message survives.
    super({ ...args, message, cause: args.cause })
  }
}
