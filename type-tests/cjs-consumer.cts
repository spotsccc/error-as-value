// CommonJS consumer: resolves the `require` condition (dist/cjs/*.d.ts).
import eav = require('@spotsccc/error-as-value')
import vitest = require('vitest')
const { expectTypeOf } = vitest

class AppError extends eav.createTaggedError({ name: 'AppError', extendable: true }) {}
class HttpStatusError extends eav.createTaggedError({
  name: 'HttpStatusError',
  message: 'Request $method $path failed with status $status',
  extends: AppError,
}) {}

declare const e: HttpStatusError
const a: AppError = e
void a
expectTypeOf(e._tag).toEqualTypeOf<'HttpStatusError'>()
declare const x: HttpStatusError | Response
if (!(x instanceof AppError)) expectTypeOf(x).toEqualTypeOf<Response>()

declare const r: HttpStatusError | number
if (eav.isError(r)) expectTypeOf(r).toEqualTypeOf<HttpStatusError>()
