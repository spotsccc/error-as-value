import { describe, test, expect } from 'vitest'
import {
  AbortError,
  createTaggedError,
  findCause,
  isAbortError,
  isError,
  matchError,
} from './index.js'

class AppError extends createTaggedError({ name: 'AppError', extendable: true }) {
  readonly retryable: boolean = false
  describe(): string {
    return `${this._tag}: ${this.message}`
  }
}

class HttpStatusError extends createTaggedError({
  name: 'HttpStatusError',
  message: 'Request $method $path failed with status $status',
  extends: AppError,
}) {}

class HttpStatusBase extends createTaggedError({
  name: 'HttpStatusBase',
  message: 'Request to $path failed',
  extends: AppError,
  extendable: true,
}) {}

class NotFoundStatusError extends createTaggedError({
  name: 'NotFoundStatusError',
  message: 'Resource $resource not found ($path)',
  extends: HttpStatusBase,
}) {}

class OtherError extends createTaggedError({ name: 'OtherError', message: 'other' }) {}

describe('extendable tagged base', () => {
  test('child of an extendable base: instanceof, tag, message, variables', () => {
    const err = new HttpStatusError({ method: 'GET', path: '/users', status: 503 })

    expect(err).toBeInstanceOf(HttpStatusError)
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(OtherError)
    expect(err._tag).toBe('HttpStatusError')
    expect(err.name).toBe('HttpStatusError')
    expect(err.message).toBe('Request GET /users failed with status 503')
    expect(err.messageTemplate).toBe('Request $method $path failed with status $status')
    expect(err.fingerprint).toEqual([
      'HttpStatusError',
      'Request $method $path failed with status $status',
    ])
    expect(err.method).toBe('GET')
    expect(err.status).toBe(503)
    expect(err.retryable).toBe(false)
    expect(err.describe()).toBe('HttpStatusError: Request GET /users failed with status 503')
    expect(HttpStatusError.tag).toBe('HttpStatusError')
    expect(AppError.tag).toBe('AppError')
  })

  test('the reproduction from the bug report runs the narrowed branches', () => {
    const e = new HttpStatusError({ method: 'GET', path: '/', status: 500 })
    let reached = false
    if (e instanceof AppError) {
      reached = true
      const tag: 'HttpStatusError' = e._tag
      expect(tag).toBe('HttpStatusError')
    }
    expect(reached).toBe(true)

    const a: AppError = e
    expect(a._tag).toBe('HttpStatusError')

    const pick = (ok: boolean): HttpStatusError | Response =>
      ok ? new Response('ok') : e
    const x = pick(true)
    if (!(x instanceof AppError)) {
      const r: Response = x
      expect(r.status).toBe(200)
    }
  })

  test('extendable base constructed directly', () => {
    const err = new AppError({ message: 'boom' })
    expect(err._tag).toBe('AppError')
    expect(err.message).toBe('boom')
    expect(err.fingerprint).toEqual(['AppError', '$message'])
    expect(err).not.toBeInstanceOf(HttpStatusError)
    expect(Object.keys(err)).not.toContain('extendable')
  })

  test('three-level chain', () => {
    const cause = new Error('socket hang up')
    const err = new NotFoundStatusError({ resource: 'user', path: '/u/1', cause })

    expect(err).toBeInstanceOf(NotFoundStatusError)
    expect(err).toBeInstanceOf(HttpStatusBase)
    expect(err).toBeInstanceOf(AppError)
    expect(err).not.toBeInstanceOf(HttpStatusError)
    expect(err._tag).toBe('NotFoundStatusError')
    expect(err.name).toBe('NotFoundStatusError')
    expect(err.message).toBe('Resource user not found (/u/1)')
    expect(err.fingerprint).toEqual([
      'NotFoundStatusError',
      'Resource $resource not found ($path)',
    ])
    expect(err.path).toBe('/u/1')
    expect(err.retryable).toBe(false)
    expect(err.cause).toBe(cause)
    expect(err.stack!.split('\n')[0]).toBe('NotFoundStatusError: Resource user not found (/u/1)')
    expect(err.stack!.split('Caused by:')).toHaveLength(2)
  })

  test('toJSON of a child', () => {
    const cause = new Error('root')
    const err = new HttpStatusError({ method: 'POST', path: '/p', status: 400, cause })
    expect(err.toJSON()).toMatchObject({
      _tag: 'HttpStatusError',
      name: 'HttpStatusError',
      message: 'Request POST /p failed with status 400',
      messageTemplate: 'Request $method $path failed with status $status',
      fingerprint: ['HttpStatusError', 'Request $method $path failed with status $status'],
      method: 'POST',
      path: '/p',
      status: 400,
      cause: { name: 'Error', message: 'root' },
    })
    expect(JSON.parse(JSON.stringify(err))._tag).toBe('HttpStatusError')
  })

  test('findCause walks to a child through its base class', () => {
    const inner = new NotFoundStatusError({ resource: 'user', path: '/u/1' })
    const outer = new OtherError({ cause: inner })

    expect(findCause(outer, AppError)).toBe(inner)
    expect(findCause(outer, HttpStatusBase)).toBe(inner)
    expect(outer.findCause(NotFoundStatusError)?.resource).toBe('user')
    expect(outer.findCause(HttpStatusError)).toBeUndefined()
    expect(inner.findCause(AppError)).toBe(inner)
  })

  test('is() follows the class chain', () => {
    const err = new HttpStatusError({ method: 'GET', path: '/', status: 500 })
    expect(AppError.is(err)).toBe(true)
    expect(HttpStatusError.is(err)).toBe(true)
    expect(HttpStatusBase.is(err)).toBe(false)
    expect(HttpStatusError.is(new AppError({ message: 'x' }))).toBe(false)
    const list: unknown[] = [err, 1, new OtherError()]
    expect(list.filter(HttpStatusError.is)).toEqual([err])
  })

  test('matchError dispatches children by tag and the open base to Error', () => {
    const describe = (e: HttpStatusError | NotFoundStatusError | AppError | OtherError) =>
      matchError(e, {
        HttpStatusError: (err) => `http ${err.status}`,
        NotFoundStatusError: (err) => `missing ${err.resource}`,
        OtherError: () => 'other',
        Error: (err) => `base ${err._tag}`,
      })

    expect(describe(new HttpStatusError({ method: 'GET', path: '/', status: 500 }))).toBe('http 500')
    expect(describe(new NotFoundStatusError({ resource: 'r', path: '/' }))).toBe('missing r')
    expect(describe(new OtherError())).toBe('other')
    expect(describe(new AppError({ message: 'x' }))).toBe('base AppError')
  })

  test('isError narrows a child out of a value union', () => {
    const load = (fail: boolean): HttpStatusError | string =>
      fail ? new HttpStatusError({ method: 'GET', path: '/', status: 500 }) : 'ok'
    const value = load(false)
    if (isError(value)) throw value
    expect(value.toUpperCase()).toBe('OK')
  })
})

describe('extendable abort base', () => {
  class CancelledError extends createTaggedError({
    name: 'CancelledError',
    extends: AbortError,
    extendable: true,
  }) {}
  class RequestTimeoutError extends createTaggedError({
    name: 'RequestTimeoutError',
    message: 'Request to $url timed out',
    extends: CancelledError,
  }) {}

  test('isAbortError finds a child of an AbortError-based base in a cause chain', () => {
    const timeout = new RequestTimeoutError({ url: '/slow' })
    const wrapped = new HttpStatusError({ method: 'GET', path: '/slow', status: 0, cause: timeout })
    const outer = new OtherError({ cause: wrapped })

    expect(timeout).toBeInstanceOf(AbortError)
    expect(timeout.name).toBe('RequestTimeoutError')
    expect(isAbortError(timeout)).toBe(true)
    expect(isAbortError(outer)).toBe(true)
    expect(findCause(outer, CancelledError)).toBe(timeout)
    expect(isAbortError(new HttpStatusError({ method: 'GET', path: '/', status: 500 }))).toBe(false)
  })
})
