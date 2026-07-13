import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..',
)
const consumerRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'error-as-value-consumer-'),
)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const tsc = path.join(
  repositoryRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
)

const run = (command, args, options = {}) =>
  childProcess.execFileSync(command, args, {
    cwd: consumerRoot,
    stdio: 'inherit',
    ...options,
  })

try {
  fs.writeFileSync(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  )

  run(npm, [
    'install',
    `git+${url.pathToFileURL(repositoryRoot).href}`,
    '--foreground-scripts',
    '--no-audit',
    '--no-fund',
  ])

  run(process.execPath, [
    '--input-type=module',
    '--eval',
    "import { createTaggedError, matchError } from '@spotsccc/error-as-value'; if (typeof createTaggedError !== 'function' || typeof matchError !== 'function') process.exit(1)",
  ])
  run(process.execPath, [
    '--eval',
    "const { createTaggedError, matchError } = require('@spotsccc/error-as-value'); if (typeof createTaggedError !== 'function' || typeof matchError !== 'function') process.exit(1)",
  ])

  fs.writeFileSync(
    path.join(consumerRoot, 'consumer.mts'),
    "import { createTaggedError, type ErrorAsValue } from '@spotsccc/error-as-value'\nclass E extends createTaggedError({ name: 'E', message: 'Failure' }) {}\nconst handle = (result: ErrorAsValue<string, E>) => { if (!(result instanceof Error)) result.toUpperCase() }\nhandle(new E())\n",
  )
  fs.writeFileSync(
    path.join(consumerRoot, 'consumer.cts'),
    "import { createTaggedError, type ErrorAsValue } from '@spotsccc/error-as-value'\nclass E extends createTaggedError({ name: 'E', message: 'Failure' }) {}\nconst handle = (result: ErrorAsValue<string, E>) => { if (!(result instanceof Error)) result.toUpperCase() }\nhandle(new E())\n",
  )
  run(tsc, [
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--strict',
    '--noEmit',
    'consumer.mts',
    'consumer.cts',
  ])

  const packageRoot = path.join(
    consumerRoot,
    'node_modules',
    '@spotsccc',
    'error-as-value',
  )
  const cliOutput = childProcess.execFileSync(
    process.execPath,
    [path.join(packageRoot, 'dist', 'cli.js'), 'skill'],
    { encoding: 'utf8' },
  )
  const skillPath = path.join(
    packageRoot,
    'skills',
    'error-as-value',
    'SKILL.md',
  )

  assert.equal(cliOutput, fs.readFileSync(skillPath, 'utf8'))
  assert.ok(
    fs.existsSync(
      path.join(
        packageRoot,
        'skills',
        'error-as-value',
        'agents',
        'openai.yaml',
      ),
    ),
  )
} finally {
  fs.rmSync(consumerRoot, { recursive: true, force: true })
}
