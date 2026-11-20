/**
 * The core type: either an Error or a value T.
 * Unlike Result<T, E>, this is just a union - no wrapper needed.
 */
export type ErrorAsValue<T, E extends Error = Error> = E | T

/**
 * Extract the error type from an ErrorAsValue union.
 * @example InferError<NetworkError | User> // NetworkError
 */
export type InferError<T> = T extends Error ? T : never

/**
 * Extract the value type from an ErrorAsValue union.
 * @example InferValue<NetworkError | User> // User
 */
export type InferValue<T> = T extends Error ? never : T

/**
 * Utility to ensure T is not an Error type.
 * Used to prevent ambiguous unions like Error | Error.
 */
export type EnsureNotError<T> = T extends Error
  ? 'Error: Value type T cannot extend Error - this would make the union ambiguous'
  : T

/**
 * The error side of V. `Extract<V, Error>` is `never` for `unknown` (so
 * narrowing `unknown` with isError would yield never); treat `unknown` as
 * `Error` instead. `any` and concrete unions are unchanged.
 */
export type ErrorsOf<V> = 0 extends 1 & V
  ? Extract<V, Error>
  : unknown extends V
    ? Error
    : Extract<V, Error>

/**
 * ErrorsOf<V> restricted to V, usable as a type predicate on a `V` parameter.
 */
export type NarrowErrors<V> = Extract<ErrorsOf<V>, V>
