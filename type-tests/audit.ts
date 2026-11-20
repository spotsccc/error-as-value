import { expectTypeOf } from 'vitest'
import {
  TaggedError,
  andThen,
  andThenAsync,
  createTaggedError,
  findCause,
  isAbortError,
  isError,
  isOk,
  isTimeoutError,
  map,
  mapError,
  match,
  partition,
  tryFn,
  unwrapOr,
} from '@spotsccc/error-as-value'

class NetworkError extends createTaggedError({ name: 'NetworkError', message: 'fetch $url failed' }) {}
class ParseError extends createTaggedError({ name: 'ParseError', message: 'bad json' }) {}

// ---------------------------------------------------------------------------
// unknown keeps an Error side
// ---------------------------------------------------------------------------

declare const u: unknown
if (isError(u)) expectTypeOf(u).toEqualTypeOf<Error>()
if (isOk(u)) expectTypeOf(u).toEqualTypeOf<unknown>()
// Known limitation: no type means "unknown minus Error", so the false branch of
// isOk(unknown) is never. Use isError(u) for the error branch instead.
else expectTypeOf(u).toBeNever()
expectTypeOf(map(u, () => 1)).toEqualTypeOf<Error | number>()
expectTypeOf(andThen(u, () => 'x' as const)).toEqualTypeOf<Error | 'x'>()
expectTypeOf(andThenAsync(u, async () => 1)).toEqualTypeOf<Promise<Error | number>>()
mapError(u, (e) => {
  expectTypeOf(e).toEqualTypeOf<Error>()
  return new ParseError({ cause: e })
})
match(u, {
  ok: (v) => expectTypeOf(v).toEqualTypeOf<unknown>(),
  err: (e) => expectTypeOf(e).toEqualTypeOf<Error>(),
})
expectTypeOf(partition([u])[1]).toEqualTypeOf<Error[]>()

// tryFn over an unknown result still collapses (Error | unknown is unknown) ...
const parsed = tryFn(() => JSON.parse('1') as unknown)
expectTypeOf(parsed).toEqualTypeOf<unknown>()
// ... but narrowing it now works on both sides
if (isError(parsed)) expectTypeOf(parsed).toEqualTypeOf<Error>()

// any stays any
declare const anyValue: any
if (isError(anyValue)) expectTypeOf(anyValue).toBeAny()

// Concrete unions are unchanged
declare const r: NetworkError | ParseError | { id: number }
if (isError(r)) expectTypeOf(r).toEqualTypeOf<NetworkError | ParseError>()
else expectTypeOf(r).toEqualTypeOf<{ id: number }>()
expectTypeOf(map(r, (v) => v.id)).toEqualTypeOf<NetworkError | ParseError | number>()
expectTypeOf(unwrapOr(r, null)).toEqualTypeOf<{ id: number } | null>()
expectTypeOf(partition([r])[1]).toEqualTypeOf<(NetworkError | ParseError)[]>()

// ---------------------------------------------------------------------------
// isAbortError / isTimeoutError narrow one-sidedly
// ---------------------------------------------------------------------------

declare const res: NetworkError | Response
if (isAbortError(res)) {
  expectTypeOf(res).toExtend<NetworkError>()
  expectTypeOf(res.url).toEqualTypeOf<string | number>()
} else {
  // a non-abort NetworkError can still be here
  expectTypeOf(res).toEqualTypeOf<NetworkError | Response>()
}
function flat(): NetworkError | Response | 'cancelled' | 'timeout' {
  if (isAbortError(res)) return 'cancelled'
  if (isTimeoutError(res)) return 'timeout'
  if (res instanceof Error) return res
  expectTypeOf(res).toEqualTypeOf<Response>()
  return res
}
void flat
if (isAbortError(u)) expectTypeOf(u).toExtend<Error>()
if (isTimeoutError(u)) {
  expectTypeOf(u).toExtend<Error>()
  expectTypeOf(u.message).toEqualTypeOf<string>()
}
declare const list: unknown[]
expectTypeOf(list.filter(isAbortError)).items.toExtend<Error>()

// ---------------------------------------------------------------------------
// findCause accepts abstract classes
// ---------------------------------------------------------------------------

abstract class DomainError extends Error {
  abstract readonly code: string
}
expectTypeOf(findCause(new Error('x'), DomainError)).toEqualTypeOf<DomainError | undefined>()
expectTypeOf(new NetworkError({ url: 'u' }).findCause(DomainError)).toEqualTypeOf<
  DomainError | undefined
>()

// ---------------------------------------------------------------------------
// TaggedError over a tagged base is not never
// ---------------------------------------------------------------------------

class TBase extends TaggedError('TBase')<{ message: string; code: number }>() {}
class TChild extends TaggedError('TChild', TBase)<{ message: string; code: number; id: string }>() {}
declare const tChild: TChild
expectTypeOf(tChild._tag).toEqualTypeOf<'TChild'>()
expectTypeOf(tChild.code).toEqualTypeOf<number>()
expectTypeOf(tChild.fingerprint).toEqualTypeOf<readonly ['TChild']>()
declare const tChildOrString: TChild | string
if (!(tChildOrString instanceof Error)) expectTypeOf(tChildOrString).toEqualTypeOf<string>()

class OnTagged extends createTaggedError({ name: 'OnTagged', message: 'x $id', extends: TBase }) {}
declare const onTagged: OnTagged
expectTypeOf(onTagged._tag).toEqualTypeOf<'OnTagged'>()
expectTypeOf(onTagged.code).toEqualTypeOf<number>()

class FBase extends createTaggedError({ name: 'FBase', extendable: true }) {}
class TOnF extends TaggedError('TOnF', FBase)<{ message: string }>() {}
declare const tOnF: TOnF
expectTypeOf(tOnF._tag).toEqualTypeOf<'TOnF'>()
expectTypeOf(tOnF.fingerprint).toEqualTypeOf<readonly ['TOnF']>()
// A TaggedError's fingerprint is [tag], so it is not a structural subtype of a
// createTaggedError base ([tag, template]); subtyping is within createTaggedError.
expectTypeOf<TOnF>().not.toExtend<FBase>()
expectTypeOf<TOnF>().toExtend<Error>()
