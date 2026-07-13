import assert from 'node:assert/strict'
import fs from 'node:fs'
import childProcess from 'node:child_process'
import module from 'node:module'
import url from 'node:url'

import {
  createTaggedError,
  matchError,
} from '@spotsccc/error-as-value'

const require = module.createRequire(import.meta.url)
const {
  createTaggedError: createTaggedErrorCjs,
  matchError: matchErrorCjs,
} = require('@spotsccc/error-as-value')

for (const api of [
  { createTaggedError, matchError },
  { createTaggedError: createTaggedErrorCjs, matchError: matchErrorCjs },
]) {
  assert.equal(typeof api.createTaggedError, 'function')
  assert.equal(typeof api.matchError, 'function')

  class SmokeTestError extends api.createTaggedError({
    name: 'SmokeTestError',
    message: 'Failed for $id',
  }) {}

  const error = new SmokeTestError({ id: '42' })
  assert.equal(error.message, 'Failed for 42')
  assert.ok(error instanceof Error)
}

const cliPath = url.fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const skillPath = url.fileURLToPath(
  new URL('../skills/error-as-value/SKILL.md', import.meta.url),
)
const cliOutput = childProcess.execFileSync(process.execPath, [cliPath, 'skill'], {
  encoding: 'utf8',
})

assert.equal(cliOutput, fs.readFileSync(skillPath, 'utf8'))
