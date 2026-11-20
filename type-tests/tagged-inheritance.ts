import { expectTypeOf } from 'vitest'
import {
  createTaggedError,
  findCause,
  matchError,
  type FactoryTaggedErrorInstance,
} from '@spotsccc/error-as-value'

// Base with a custom field and method in the class body
export class AppError extends createTaggedError({
  name: 'AppError',
  extendable: true,
}) {
  readonly retryable: boolean = false
  describe(): string {
    return `${this._tag}: ${this.message}`
  }
}

export class HttpStatusError extends createTaggedError({
  name: 'HttpStatusError',
  message: 'Request $method $path failed with status $status',
  extends: AppError,
}) {}

// Middle level that is itself extended, so it is extendable too
export class HttpStatusBase extends createTaggedError({
  name: 'HttpStatusBase',
  message: 'Request to $path failed',
  extends: AppError,
  extendable: true,
}) {}

// Third level
export class NotFoundStatusError extends createTaggedError({
  name: 'NotFoundStatusError',
  message: 'Resource $resource not found ($path)',
  extends: HttpStatusBase,
}) {}

class OtherError extends createTaggedError({ name: 'OtherError', message: 'other' }) {}

// ---------------------------------------------------------------------------
// Reproduction from the bug report
// ---------------------------------------------------------------------------

declare const e: HttpStatusError
if (e instanceof AppError) {
  expectTypeOf(e).toEqualTypeOf<HttpStatusError>()
  // @ts-expect-error - the branch is reachable, so e must not be never
  const n: never = e
  void n
}
const a: AppError = e
void a

declare const x: HttpStatusError | Response
if (!(x instanceof AppError)) {
  const r: Response = x
  void r
}

// ---------------------------------------------------------------------------
// Subtyping along the whole chain
// ---------------------------------------------------------------------------

expectTypeOf<HttpStatusError>().toExtend<AppError>()
expectTypeOf<HttpStatusError>().toExtend<Error>()
expectTypeOf<NotFoundStatusError>().toExtend<HttpStatusBase>()
expectTypeOf<HttpStatusBase>().toExtend<AppError>()
expectTypeOf<NotFoundStatusError>().not.toExtend<HttpStatusError>()
expectTypeOf<NotFoundStatusError>().toExtend<AppError>()
expectTypeOf<NotFoundStatusError>().toExtend<Error>()
expectTypeOf<AppError>().not.toExtend<HttpStatusError>()
expectTypeOf<HttpStatusError>().not.toExtend<OtherError>()

declare const leaf: NotFoundStatusError
if (leaf instanceof AppError) expectTypeOf(leaf).toEqualTypeOf<NotFoundStatusError>()
if (leaf instanceof HttpStatusBase) expectTypeOf(leaf).toEqualTypeOf<NotFoundStatusError>()
if (leaf instanceof Error) expectTypeOf(leaf).toEqualTypeOf<NotFoundStatusError>()

declare const leafOrResponse: NotFoundStatusError | Response
if (!(leafOrResponse instanceof AppError)) expectTypeOf(leafOrResponse).toEqualTypeOf<Response>()
if (!(leafOrResponse instanceof HttpStatusBase)) expectTypeOf(leafOrResponse).toEqualTypeOf<Response>()
if (!(leafOrResponse instanceof Error)) expectTypeOf(leafOrResponse).toEqualTypeOf<Response>()
if (leafOrResponse instanceof Error) expectTypeOf(leafOrResponse).toEqualTypeOf<NotFoundStatusError>()

declare const childOrString: HttpStatusError | string
if (!(childOrString instanceof Error)) expectTypeOf(childOrString).toEqualTypeOf<string>()

// Narrowing a base-typed union down to a child
declare const baseOrOther: AppError | Response
if (baseOrOther instanceof HttpStatusError) expectTypeOf(baseOrOther).toEqualTypeOf<HttpStatusError>()
if (baseOrOther instanceof NotFoundStatusError) expectTypeOf(baseOrOther).toEqualTypeOf<NotFoundStatusError>()

// ---------------------------------------------------------------------------
// Literal tags, templates, fingerprints
// ---------------------------------------------------------------------------

expectTypeOf(e._tag).toEqualTypeOf<'HttpStatusError'>()
expectTypeOf(leaf._tag).toEqualTypeOf<'NotFoundStatusError'>()
// Extendable classes are open: their tag is any subclass's tag
declare const app: AppError
expectTypeOf(app._tag).toEqualTypeOf<string>()
expectTypeOf(AppError.tag).toEqualTypeOf<'AppError'>()
declare const mid: HttpStatusBase
expectTypeOf(mid._tag).toEqualTypeOf<string>()
expectTypeOf(e.messageTemplate).toEqualTypeOf<'Request $method $path failed with status $status'>()
expectTypeOf(app.messageTemplate).toEqualTypeOf<string>()
// A child's fingerprint is the base's `readonly [string, string]` intersected
// with its own literal tuple: mutually assignable, elements are the literals.
type HttpFingerprint = readonly ['HttpStatusError', 'Request $method $path failed with status $status']
expectTypeOf(e.fingerprint).toExtend<HttpFingerprint>()
expectTypeOf<HttpFingerprint>().toExtend<typeof e.fingerprint>()
expectTypeOf(e.fingerprint[0]).toEqualTypeOf<'HttpStatusError'>()
expectTypeOf(e.fingerprint[1]).toEqualTypeOf<'Request $method $path failed with status $status'>()
expectTypeOf(leaf.fingerprint[0]).toEqualTypeOf<'NotFoundStatusError'>()
expectTypeOf(leaf.fingerprint[1]).toEqualTypeOf<'Resource $resource not found ($path)'>()
expectTypeOf(leaf.fingerprint).toExtend<readonly ['NotFoundStatusError', 'Resource $resource not found ($path)']>()
expectTypeOf(app.fingerprint).toEqualTypeOf<readonly [string, string]>()
expectTypeOf(HttpStatusError.tag).toEqualTypeOf<'HttpStatusError'>()

// Discriminated union on _tag
declare const u: HttpStatusError | NotFoundStatusError | OtherError
if (u._tag === 'HttpStatusError') expectTypeOf(u).toEqualTypeOf<HttpStatusError>()
if (u._tag === 'OtherError') expectTypeOf(u).toEqualTypeOf<OtherError>()

// matchError sees child tags and narrows handler arguments
const matched = matchError(u, {
  HttpStatusError: (err) => {
    expectTypeOf(err).toEqualTypeOf<HttpStatusError>()
    return `${err.status}`
  },
  NotFoundStatusError: (err) => {
    expectTypeOf(err).toEqualTypeOf<NotFoundStatusError>()
    return `${err.resource}`
  },
  OtherError: (err) => err.message,
  Error: (err) => err.message,
})
expectTypeOf(matched).toEqualTypeOf<string>()

// A union that contains the open base itself still matches
declare const withBase: AppError | OtherError
const matchedBase = matchError(withBase, {
  OtherError: (err) => {
    expectTypeOf(err).toEqualTypeOf<OtherError>()
    return 'other'
  },
  Error: (err) => {
    expectTypeOf(err).toEqualTypeOf<AppError>()
    return err.message
  },
})
expectTypeOf(matchedBase).toEqualTypeOf<string>()
if (withBase._tag === 'OtherError') expectTypeOf(withBase).toEqualTypeOf<AppError | OtherError>()

// ---------------------------------------------------------------------------
// Constructor variables and inherited members
// ---------------------------------------------------------------------------

new HttpStatusError({ method: 'GET', path: '/x', status: 500 })
new HttpStatusError({ method: 'GET', path: '/x', status: 500, cause: new Error('x') })
// @ts-expect-error - $status is required
new HttpStatusError({ method: 'GET', path: '/x' })
// @ts-expect-error - args are required
new HttpStatusError()
new NotFoundStatusError({ resource: 'user', path: '/u/1' })
// @ts-expect-error - the child template replaces the base one, so $method is not a variable
new NotFoundStatusError({ resource: 'user', path: '/u/1', method: 'GET' })
// @ts-expect-error - an extendable base still requires its own message variable
new AppError()
new AppError({ message: 'boom' })

expectTypeOf(e.method).toEqualTypeOf<string | number>()
expectTypeOf(e.status).toEqualTypeOf<string | number>()
expectTypeOf(leaf.resource).toEqualTypeOf<string | number>()
expectTypeOf(e.retryable).toEqualTypeOf<boolean>()
expectTypeOf(leaf.retryable).toEqualTypeOf<boolean>()
expectTypeOf(leaf.describe()).toEqualTypeOf<string>()
expectTypeOf(e.message).toEqualTypeOf<string>()
expectTypeOf(e.stack).toEqualTypeOf<string | undefined>()
expectTypeOf(e.cause).toEqualTypeOf<unknown>()

// ---------------------------------------------------------------------------
// findCause, toJSON, is()
// ---------------------------------------------------------------------------

expectTypeOf(e.findCause(AppError)).toEqualTypeOf<AppError | undefined>()
expectTypeOf(leaf.findCause(HttpStatusBase)).toEqualTypeOf<HttpStatusBase | undefined>()
expectTypeOf(findCause(new Error('x'), HttpStatusError)).toEqualTypeOf<HttpStatusError | undefined>()
expectTypeOf(e.toJSON()).toEqualTypeOf<object>()

declare const unknownValue: unknown
// is() narrows to the factory instance type: tag, template variables and the
// base's members (including the base class body), not the leaf's own body.
if (HttpStatusError.is(unknownValue)) {
  expectTypeOf(unknownValue._tag).toEqualTypeOf<'HttpStatusError'>()
  expectTypeOf(unknownValue.status).toEqualTypeOf<string | number>()
  expectTypeOf(unknownValue.retryable).toEqualTypeOf<boolean>()
  expectTypeOf(unknownValue).toExtend<AppError>()
}
if (AppError.is(unknownValue)) {
  expectTypeOf(unknownValue._tag).toEqualTypeOf<string>()
  expectTypeOf(unknownValue).toExtend<Error>()
}
declare const childOrNumber: HttpStatusError | number
if (!AppError.is(childOrNumber)) expectTypeOf(childOrNumber).toEqualTypeOf<number>()

// The exported instance type is still usable on its own
type Inst = FactoryTaggedErrorInstance<'X', 'x $id'>
expectTypeOf<Inst['_tag']>().toEqualTypeOf<'X'>()
expectTypeOf<Inst>().toExtend<Error>()

// is() as a detached callback
declare const mixed: (HttpStatusError | OtherError | number)[]
const filtered = mixed.filter(HttpStatusError.is)
expectTypeOf(filtered).items.toExtend<AppError>()
expectTypeOf(filtered).items.not.toBeNumber()

// ---------------------------------------------------------------------------
// Closed (non-extendable) tagged base keeps the 0.15.x behavior
// ---------------------------------------------------------------------------

class ClosedBase extends createTaggedError({ name: 'ClosedBase' }) {}
class ClosedChild extends createTaggedError({
  name: 'ClosedChild',
  message: 'child $id',
  extends: ClosedBase,
}) {}
declare const closed: ClosedChild
expectTypeOf(closed._tag).toEqualTypeOf<'ClosedChild'>()
expectTypeOf(closed.id).toEqualTypeOf<string | number>()
expectTypeOf(new ClosedBase({ message: 'x' })._tag).toEqualTypeOf<'ClosedBase'>()
declare const closedOrString: ClosedChild | string
if (!(closedOrString instanceof Error)) expectTypeOf(closedOrString).toEqualTypeOf<string>()

// Plain Error base with custom fields
class PlainBase extends Error {
  readonly code: number = 500
}
class OnPlain extends createTaggedError({ name: 'OnPlain', message: 'p $id', extends: PlainBase }) {}
expectTypeOf<OnPlain>().toExtend<PlainBase>()
declare const onPlainOrString: OnPlain | string
if (onPlainOrString instanceof PlainBase) expectTypeOf(onPlainOrString).toEqualTypeOf<OnPlain>()
expectTypeOf<OnPlain['_tag']>().toEqualTypeOf<'OnPlain'>()
