# Changelog

## 0.16.0

### Tagged error inheritance

- **Fix: a subclass of a tagged base was not a subtype of it.** `x instanceof AppError` narrowed a `HttpStatusError` to `never`, `!(x instanceof AppError)` did not exclude it, and `const a: AppError = child` failed (TS2375). Cause: the base's instance type had a literal `_tag: 'AppError'` (and literal `messageTemplate`/`fingerprint`), which the child's literals can never be assigned to; `Omit`-ing them in the child (0.15.1/0.15.2) only hid the conflict. A class's own type is fixed when it is declared, so the base has to opt in.
- **New `createTaggedError({ ..., extendable: true })`** marks a class as a base for other tagged errors. Its `_tag` and `messageTemplate` are typed `string` and `fingerprint` `readonly [string, string]`; subclasses keep their literal `_tag`, are assignable to the base and `Error`, narrow both ways with `instanceof`, and inherit the base's fields and methods. Every class that is extended further needs the flag. Type-only: runtime behavior is unchanged.
  ```ts
  class AppError extends createTaggedError({ name: 'AppError', extendable: true }) {}
  class HttpStatusError extends createTaggedError({ name: 'HttpStatusError', message: '...', extends: AppError }) {}
  ```
  Without the flag, a tagged base behaves as in 0.15.2 (subclasses work at runtime, keep literal tags, but are not assignable to the base).
- `matchError` / `matchErrorPartial`: errors typed as an extendable base (`_tag: string`) go to the `Error` handler instead of turning the handler map into an index signature; subclasses still match by tag.
- Fix: `TaggedError` and `createTaggedError` classes can extend each other and `TaggedError` can extend a `TaggedError` class. Previously the constructor threw `TypeError: Cannot use 'in' operator` and the `TaggedError` instance type reduced to `never` (TS2509). Such subclasses get correct runtime values and their own literal `_tag`/`fingerprint` types, but they are not structural subtypes of the tagged base (`extendable` subtyping is a `createTaggedError` feature).
- Fix: a `createTaggedError` subclass of `UnhandledError` keeps its own message.

### Other fixes

- `isAbortError` narrows one-sidedly: the false branch no longer drops every `Error` from the union (it can still hold a non-abort error). The true branch is the error side of the input marked `AbortCaused`. Code that used the value as the success type right after `if (isAbortError(x)) return` without an `instanceof Error` check now gets a type error, as it should.
- `unknown` keeps an error side: `isError(u)` narrows to `Error` (was `never`), `map`/`andThen`/`andThenAsync` include `Error` in the result, `mapError`/`match` get `Error` in the error callback, `partition` returns `Error[]` errors. `any` and concrete unions are unchanged.
- `matchError` / `matchErrorPartial` only use own handler keys: a tag such as `constructor` or `toString` no longer dispatches to `Object.prototype` members.
- `findCause` (function and method) accepts abstract error classes.
- `DisposableStack` / `AsyncDisposableStack`: a disposer that throws `undefined` is rethrown instead of swallowed; `use()` throws a `TypeError` right away for a value without a dispose method (as the native stacks do) instead of failing at disposal.
- The sources type check under `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.

### Added

- `isTimeoutError(error)`: walks the cause chain for an error named `TimeoutError`, such as the `DOMException` that `fetch` rejects with when `AbortSignal.timeout(ms)` fires. `isAbortError` is unchanged and does not match it.
- Exported types `AbortCaused`, `TimeoutCaused`.
- Consumer type tests (`type-tests/`, `bun run typecheck:types`, in CI) against the built ESM and CommonJS declarations with `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `moduleResolution: nodenext`.

## 0.15.2

- Fix type narrowing for subclasses of a tagged base (regression in 0.15.1): `x instanceof Error` now narrows them out of `Error | T`, and `matchError` sees their tags. The instance type intersects the `Omit`ted base with `Error` again.

## 0.15.1

- Fix `createTaggedError({ extends })` with a base class that was itself built by `createTaggedError`: the subclass now passes an args object to the tagged base instead of `(message, options)` (previously a `TypeError`), only the outermost class sets `name`, `message` and the `Caused by:` stack suffix, and the instance type drops the base's `_tag`, `messageTemplate` and `fingerprint` instead of reducing to `never` (TS2509).
- Type check test files in CI (`typecheck:test`).
- Sync the bundled skill: dependency gate, read installed types, reuse shared error packages, `tryAsync(fn, catchFn)`, `matchErrorPartial`, verify step.
- Rename the package and import contract to `@spotsccc/error-as-value`, with direct named imports from the package root.
- Rename the bundled agent skill to `error-as-value`.
- Restore dual ESM and CommonJS package entrypoints, including format-specific TypeScript declarations.
- Add package smoke tests for Node.js `import` and `require` consumers.
- Refresh and validate the bundled `error-as-value` agent skill for installation from `spotsccc/error-as-value`.
- Add CI coverage for build, tests, package contents, and both Node.js module systems.

## 0.14.1

1. **Fixed `tryFn`/`tryAsync` catch handler accepting non-Error return values** — the `catch` callback previously required returning an `Error` subclass. It now accepts any value: returning `undefined`, `null`, or a fallback value swallows the error and widens the result union accordingly:
   ```ts
   const result = tryFn({
     try: () => JSON.parse(input),
     catch: () => undefined,   // result: ParsedType | undefined
   })
   ```
2. **`tryAsync` marked as deprecated** — use `.catch()` directly on the promise instead. It composes naturally with async/await and TypeScript infers the union automatically without a wrapper:
   ```ts
   // Before:
   const result = await tryAsync({ try: () => fetch(url), catch: (e) => new NetworkError({ cause: e }) })

   // After:
   const result = await fetch(url).catch((e) => new NetworkError({ url, cause: e }))
   ```
3. **Fixed `error-as-value skill` CLI command** — the SKILL.md file was relocated to `skills/error-as-value/SKILL.md` and the CLI path lookup was updated to match. Running `error-as-value skill` now correctly outputs the skill content.

## 0.14.0

- Make `message` optional in `createTaggedError` — omitting it defaults to `'$message'`, so callers can pass the message at construction time without defining it in the template
- Validate reserved variable names (`$_tag`, `$name`, `$stack`, `$cause`) at class creation time — they now throw immediately instead of silently conflicting with Error internals
- Add `isAbortError` type guard (`error is Error`) so TypeScript narrows the variable after the check without requiring a cast
- Precompile `createTaggedError` template interpolation at class-creation time using a closure-based interpolator — removes per-instance regex work on the hot path
- Precompute `serializableVarNames` to skip the `RESERVED_KEYS` filter on every constructor call
- Add fast paths in `compileMessageInterpolator` for 0 and 1 placeholder templates
- Harden `createTaggedError` internals: forbid `$message` placeholder (conflicts with the optional-message feature), tighten reserved-key handling for `message`/`cause`, ensure `toJSON` cannot be overridden by template variables
- Deduplicate cause serialization into shared `serializeCause` helper
- Fix CLI path resolution to use `fileURLToPath` for cross-platform compatibility
- Move worker-only packages to `devDependencies`
- Add SKILL.md Rule 18: keep abort checks flat with `.catch`, never nest `isAbortError` inside `instanceof Error`
- Add SKILL.md Rule 19: don't reassign after error early returns — TypeScript narrows the original variable automatically
- Compress SKILL.md by ~22% — remove duplicate pattern sections, merge unique info, preserve all flat control flow guidance

## 0.13.0

- Add `AbortError` base class and `isAbortError` utility for typed abort/cancellation handling
  - `AbortError` extends `Error` with `name = 'AbortError'` — use as the `extends` base for custom abort errors so `isAbortError` can detect them even when wrapped in a cause chain
  - `isAbortError(error)` walks the full `.cause` chain, detecting: native `DOMException` from bare `controller.abort()`, direct `AbortError` instances, and tagged errors that extend `AbortError` (where `.name` is overridden to the tag)
  - Handles circular `.cause` references safely with a `Set`
  - 11 new tests covering all detection paths, edge cases, and circular cause protection
- Document idiomatic `.catch()` pattern for async boundaries (replaces `tryAsync` in all examples)
  - `promise.catch((e) => new MyError({ cause: e }))` is now the canonical form — simpler, no wrapper object, TypeScript infers the union automatically
  - `tryAsync` still exists but `.catch()` is the preferred style
  - `tryFn` remains the right tool for sync throwing code (`JSON.parse`, etc.)
  - Updated SKILL.md rules 12–17, all before/after examples, README, MIGRATION.md, and comparison page
- Add `controller.abort()` typed reason convention to SKILL.md
  - `abort(reason)` throws `reason` as-is — MUST pass a tagged error extending `AbortError`, never plain `Error` or string
  - New "Abort & Cancellation" recipe section with full before/after example
- Export `AbortError` and `isAbortError` from the package root

## 0.12.0

- Add `DisposableStack` and `AsyncDisposableStack` polyfills for Go-like defer cleanup semantics using TC39 Explicit Resource Management (`using` / `await using`)
  - Works in every runtime — no native DisposableStack support required
  - Provides `defer()`, `use()`, `adopt()`, `move()` methods with LIFO cleanup ordering
  - Includes SuppressedError fallback for error chaining
  - 32 tests covering LIFO ordering, double-dispose safety, error chaining, and package integration patterns
- Add `/error-as-value-vs-effect` comparison page showing side-by-side code examples of Error as Value vs Effect.ts patterns
  - Server-side syntax highlighting with @code-hike/lighter
  - 25+ sections covering error handling, async, retries, timeouts, cleanup, and architecture patterns
  - Light/dark theme toggle via CSS prefers-color-scheme
- Add benchmarks comparing Effect.gen vs direct error-union performance
  - Direct error unions are 3-8x faster in sync loops, 4-7x faster in async
  - Near-zero heap allocations vs Effect's kb-range
- Expand SKILL.md with comprehensive agent-oriented reference
  - 16 self-contained before/after recipe patterns
  - Rules for try/tryAsync boundary placement (use at lowest call stack level only)
  - Flat control flow patterns (avoid nesting, prefer early returns)
  - TypeScript rules for isTruthy filters, AbortController with Error instances, no silent catch blocks
- Add return type inference guidance to SKILL.md
- Add Effect.ts before/after comparison examples to documentation
- Rename `bench/` to `benchmarks/`

## 0.11.0

- Add `fingerprint` property to all tagged errors for stable Sentry/logging error grouping
  - `createTaggedError` errors return `[_tag, messageTemplate]` — groups all instances of the same error class regardless of interpolated values
  - `TaggedError` errors return `[_tag]`
  - Directly usable as `event.fingerprint` in Sentry's `beforeSend` hook
- Add `messageTemplate` property to `createTaggedError` errors — exposes the raw `$variable` template string (e.g. `'User $id not found in $database'`)
- Include `fingerprint` and `messageTemplate` in `toJSON()` output for structured logging
- Guard reserved internal keys (`_tag`, `fingerprint`, `messageTemplate`, `name`, `stack`) from being overwritten by user-provided props or template variables
- Replace `Object.assign(this, args)` in `TaggedError` with key-by-key loop that skips reserved keys
- Add CLI with `error-as-value skill` command to output SKILL.md contents for LLM context

## 0.10.0

- Add `findCause` to walk the `.cause` chain and find an ancestor matching a specific error class (Go's `errors.As` equivalent)
- Available as instance method on all tagged errors (`.findCause(ErrorClass)`) and as standalone function (`findCause(err, ErrorClass)`)
- Returns `T | undefined` for use with optional chaining (`err.findCause(DbError)?.host`)
- Safe against circular `.cause` references
- Add docs for `findCause` in README and SKILL.md
- Add docs for error wrapping with `cause` and custom base class with `extends`

## 0.9.0

- **BREAKING:** rename `_` to `Error` in matchError handlers, fallback now always required
- **fix:** only catch Error instances in tryFn/tryAsync, re-throw non-Error values

## 0.8.2

- replace tsup with **tsc**
- add **declaration source maps**
- include **src** in package

## 0.8.1

- **ESM only** - remove CJS build

## 0.8.0

- Fix **npm exports** - correct ESM/CJS paths (`index.js`/`index.cjs` not `.mjs`)
- Add `createTaggedError` factory with `$variable` message interpolation
- Variables in message templates are automatically extracted and required in constructor
- Supports custom base class via `extends` option
- Recommended pattern: `class MyError extends createTaggedError({...}) {}`

## 0.7.1

- Export `tryFn` as `try` for namespace consumers (`try()` instead of `tryFn()`)
- Update README and MIGRATION docs to use direct named imports from `@spotsccc/error-as-value`

## 0.7.0

- Bump to 0.7.0

## 0.6.0

- Switch to NodeNext module resolution
- Add API error handling example
- Add custom base class support to TaggedError
