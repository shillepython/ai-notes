// Copies the freshly built "AI Notes.app" into /Applications (run via `npm run install-app`,
// which builds it first). Quits a running copy so the bundle can be replaced.
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const APP = 'AI Notes.app'
const DEST = join('/Applications', APP)

if (process.platform !== 'darwin') {
  console.error('install-app works only on macOS.')
  process.exit(1)
}

const built = readdirSync('dist')
  .filter((d) => d.startsWith('mac'))
  .map((d) => join('dist', d, APP))
  .find((p) => existsSync(p))
if (!built) {
  console.error(`Built app not found in dist/mac*/${APP}. Run: npm run pack:mac`)
  process.exit(1)
}

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status === 0

// Ask a running instance to quit; ignore the error when it isn't running.
spawnSync('osascript', ['-e', 'tell application id "com.shillepython.ainotes" to quit'], {
  stdio: 'ignore'
})

rmSync(DEST, { recursive: true, force: true })
if (!run('ditto', [built, DEST])) {
  console.error(`Failed to copy ${built} to ${DEST}`)
  process.exit(1)
}
// A local build isn't quarantined, but clear the flag anyway so Gatekeeper doesn't block it.
spawnSync('xattr', ['-dr', 'com.apple.quarantine', DEST], { stdio: 'ignore' })

console.log(`Installed ${DEST}`)
run('open', [DEST])
