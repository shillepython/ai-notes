// Downloads the Electron binary if npm skipped electron's own install script
// (e.g. `ignore-scripts` or a newer npm that doesn't run dependency scripts).
// Without it electron-vite fails with "Electron uninstall".
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve('electron/package.json'))
const pathFile = join(electronDir, 'path.txt')

const installed = () =>
  existsSync(pathFile) && existsSync(join(electronDir, 'dist', readFileSync(pathFile, 'utf-8').trim()))

if (!installed()) {
  console.log('Electron binary is missing, downloading it…')
  const res = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
  if (res.status !== 0 || !installed()) {
    console.error('Failed to download Electron. Try: node node_modules/electron/install.js')
    process.exit(1)
  }
}
