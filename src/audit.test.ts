import { describe, test, expect } from 'vitest'
import {
  AbortError,
  AsyncDisposableStack,
  DisposableStack,
  TaggedError,
  createTaggedError,
  findCause,
  isAbortError,
  isError,
  isTimeoutError,
  map,
  matchError,
  matchErrorPartial,
  partition,
} from './index.js'

describe('TaggedError and createTaggedError bases mix', () => {
  class TBase extends TaggedError('TBase')<{ message: string; code: number }>() {}
  class FBase extends createTaggedError({ name: 'FBase', extendable: true }) {}

  test('TaggedError extends a TaggedError class', () => {
    class Child extends TaggedError('Child', TBase)<{
      message: string
      code: number
      id: string
    }>() {}
    const cause = new Error('root')
    const err = new Child({ message: 'boom', code: 7, id: 'x', cause } as never)

    expect(err).toBeInstanceOf(TBase)
    expect(err._tag).toBe('Child')
    expect(err.name).toBe('Child')
    expect(err.message).toBe('boom')
    expect(err.code).toBe(7)
    expect(err.id).toBe('x')
    expect(err.cause).toBe(cause)
    expect(err.fingerprint).toEqual(['Child'])
    expect(err.stack!.split('\n')[0]).toBe('Child: boom')
    expect(err.stack!.split('Caused by:')).toHaveLength(2)
  })

  test('createTaggedError extends a TaggedError class', () => {
    class Child extends createTaggedError({
      name: 'Child',
      message: 'item $id failed',
      extends: TBase,
    }) {}
    const err = new Child({ id: 42 })

    expect(err).toBeInstanceOf(TBase)
    expect(err._tag).toBe('Child')
    expect(err.name).toBe('Child')
    expect(err.message).toBe('item 42 failed')
    expect(err.id).toBe(42)
    expect(err.stack!.split('\n')[0]).toBe('Child: item 42 failed')
  })

  test('TaggedError extends a createTaggedError class', () => {
    class Child extends TaggedError('Child', FBase)<{ message: string; id: string }>() {}
    const cause = new Error('root')
    const err = new Child({ message: 'boom', id: 'y', cause } as never)

    expect(err).toBeInstanceOf(FBase)
    expect(err._tag).toBe('Child')
    expect(err.name).toBe('Child')
    expect(err.message).toBe('boom')
    expect(err.id).toBe('y')
    expect(err.cause).toBe(cause)
    expect(err.stack!.split('Caused by:')).toHaveLength(2)
  })
})

describe('matchError only dispatches own handler keys', () => {
  class Ctor extends createTaggedError({ name: 'constructor', message: 'c' }) {}
  class ToStr extends createTaggedError({ name: 'toString', message: 't' }) {}

  test('tags named like Object.prototype members fall back to Error', () => {
    const err = new Ctor() as Error
    expect(matchError(err, { Error: () => 'fallback' })).toBe('fallback')
    expect(matchError(new ToStr() as Error, { Error: () => 'fallback' })).toBe('fallback')
    expect(matchErrorPartial(new ToStr() as Error, {}, () => 'partial')).toBe('partial')
  })
})

describe('unknown values keep their error side', () => {
  const parse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch (e) {
      return e as Error
    }
  }

  test('isError narrows unknown to Error, map keeps the error', () => {
    const value = parse('{')
    if (isError(value)) {
      expect(value.message).toContain('JSON')
    } else {
      throw new Error('expected an error')
    }
    const mapped = map(value, () => 1)
    expect(mapped).toBeInstanceOf(Error)
    const [, errs] = partition([value, parse('1')])
    expect(errs.map((e) => e.name)).toEqual(['SyntaxError'])
  })
})

describe('isTimeoutError', () => {
  test('detects the DOMException from AbortSignal.timeout, also in a cause chain', async () => {
    const signal = AbortSignal.timeout(1)
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    const reason = signal.reason as unknown
    expect(isTimeoutError(reason)).toBe(true)
    expect(isTimeoutError(new Error('wrap', { cause: reason }))).toBe(true)
    // unchanged: a timeout is not an abort
    expect(isAbortError(reason)).toBe(false)
  })

  test('detects errors named TimeoutError and rejects others', () => {
    class RequestTimeoutError extends createTaggedError({
      name: 'TimeoutError',
      message: 'timed out',
    }) {}
    expect(isTimeoutError(new RequestTimeoutError())).toBe(true)
    expect(isTimeoutError(new DOMException('aborted', 'AbortError'))).toBe(false)
    expect(isTimeoutError(new AbortError())).toBe(false)
    expect(isTimeoutError(new Error('x'))).toBe(false)
    expect(isTimeoutError('TimeoutError')).toBe(false)
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    ;(a as { cause?: unknown }).cause = b
    expect(isTimeoutError(a)).toBe(false)
  })
})

describe('findCause', () => {
  test('accepts abstract error classes', () => {
    abstract class DomainError extends Error {}
    class Concrete extends DomainError {}
    const inner = new Concrete('x')
    const found = findCause(new Error('outer', { cause: inner }), DomainError)
    expect(found).toBe(inner)
  })
})

describe('DisposableStack edge cases', () => {
  test('a disposer that throws undefined is rethrown', () => {
    const stack = new DisposableStack()
    stack.defer(() => {
      throw undefined
    })
    let caught = false
    try {
      stack.dispose()
    } catch (e) {
      caught = true
      expect(e).toBeUndefined()
    }
    expect(caught).toBe(true)
  })

  test('async: a disposer that throws undefined is rethrown', async () => {
    const stack = new AsyncDisposableStack()
    stack.defer(async () => {
      throw undefined
    })
    let caught = false
    await stack.disposeAsync().catch(() => {
      caught = true
    })
    expect(caught).toBe(true)
  })

  test('use() rejects a value without a dispose method right away', () => {
    const stack = new DisposableStack()
    expect(() => stack.use({} as Disposable)).toThrow(TypeError)
    const asyncStack = new AsyncDisposableStack()
    expect(() => asyncStack.use({} as AsyncDisposable)).toThrow(TypeError)
  })
})

describe('UnhandledError as a tagged base', () => {
  test('a subclass keeps its own message', async () => {
    const { UnhandledError } = await import('./index.js')
    class WrappedUnhandled extends createTaggedError({
      name: 'WrappedUnhandled',
      message: 'step $step crashed',
      extends: UnhandledError,
    }) {}
    const cause = new Error('boom')
    const err = new WrappedUnhandled({ step: 'parse', cause })
    expect(err).toBeInstanceOf(UnhandledError)
    expect(err.message).toBe('step parse crashed')
    expect(err._tag).toBe('WrappedUnhandled')
    expect(err.cause).toBe(cause)

    const plain = new UnhandledError({ cause })
    expect(plain.message).toBe('Unhandled exception: boom')
  })
})
