/**
 * Builds the development APK: the same app, but its WebView loads the renderer
 * from `npm run dev:mobile` on this machine instead of from inside the APK, so a
 * saved .tsx/.css shows up on the phone through Vite's hot reload. Native HTTP and
 * the video relay in MainActivity still run, so streams behave as they do in the
 * real build.
 *
 * Install it once. Rebuild only when this machine's address changes - it is
 * baked in, and printed below. Needs JAVA_HOME and ANDROID_HOME set.
 */
import { execSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces, homedir } from 'node:os'
import { join } from 'node:path'

const PORT = 5174

// Skip virtual adapters (WSL, Hyper-V, VPNs): the phone has to be able to reach it.
const VIRTUAL = /vethernet|virtual|wsl|hyper-v|vmware|vbox|loopback|tailscale|zerotier/i
const candidates = Object.entries(networkInterfaces())
  .filter(([name]) => !VIRTUAL.test(name))
  .flatMap(([name, addrs]) => (addrs ?? []).map((a) => ({ name, ...a })))
  .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))

const host = process.env.SLIPSTREAM_DEV_HOST ?? candidates[0]?.address
if (!host) {
  console.error('No LAN address found. Set SLIPSTREAM_DEV_HOST to the address the phone can reach.')
  process.exit(1)
}
const url = `http://${host}:${PORT}`

const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd })

run('npx cap sync android')

// cap sync just rewrote this from capacitor.config.json; point it at the dev server.
const configPath = 'android/app/src/main/assets/capacitor.config.json'
const config = JSON.parse(readFileSync(configPath, 'utf8'))
config.server = { url, cleartext: true }
writeFileSync(configPath, JSON.stringify(config, null, 2))

run(process.platform === 'win32' ? 'gradlew.bat assembleDebug' : './gradlew assembleDebug', 'android')

const out = join(homedir(), 'Desktop', 'Slipstream-dev.apk')
copyFileSync('android/app/build/outputs/apk/debug/app-debug.apk', out)
console.log(`\nDev APK: ${out}\nIt loads ${url} - start that with: npm run dev:mobile`)
if (candidates.length > 1)
  console.log(`(Other addresses here: ${candidates.slice(1).map((c) => `${c.address} on ${c.name}`).join(', ')})`)
