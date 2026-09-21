import { readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { AUTH_SCOPES, type AuthStatus, type TwitchUser } from '@shared/types'

/**
 * Whatever the OS gives us for encrypting at rest — Electron's safeStorage in
 * the app, which is DPAPI on Windows. Injected rather than imported so this
 * module runs under plain node: the token lifecycle is the most security
 * sensitive code here and deserves to be exercised directly.
 */
export interface Encryptor {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

const DEVICE_URL = 'https://id.twitch.tv/oauth2/device'
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate'
const REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke'
const HELIX_USERS = 'https://api.twitch.tv/helix/users'

const SCOPES = AUTH_SCOPES.join(' ')

interface StoredTokens {
  accessToken: string
  refreshToken: string | null
  /** Epoch ms. Refreshed a little early rather than on a 401. */
  expiresAt: number
  user: TwitchUser
  scopes: string[]
}

let userDataDir = ''
let clientId: string | null = null
let tokens: StoredTokens | null = null
let persistent = true
let broadcast: (status: AuthStatus) => void = () => {}
let crypto: Encryptor = {
  isAvailable: () => false,
  encrypt: () => Buffer.alloc(0),
  decrypt: () => ''
}

/** Device flow in progress, so it can be cancelled or superseded. */
let polling: { deviceCode: string; cancelled: boolean } | null = null
let pendingInfo: { userCode: string; verificationUri: string; expiresAt: number } | null = null
let lastError: string | null = null

export function initAuth(
  dir: string,
  onStatus: (status: AuthStatus) => void,
  encryptor: Encryptor
): void {
  userDataDir = dir
  broadcast = onStatus
  crypto = encryptor
}

const clientIdPath = (): string => join(userDataDir, 'auth', 'client-id')
const tokenPath = (): string => join(userDataDir, 'auth', 'tokens.bin')

// ----------------------------------------------------------------- status

export function status(): AuthStatus {
  const state = !clientId
    ? 'needs_client_id'
    : tokens
      ? 'signed_in'
      : polling
        ? 'pending'
        : lastError
          ? 'error'
          : 'signed_out'

  return {
    state,
    user: tokens?.user ?? null,
    scopes: tokens?.scopes ?? [],
    userCode: pendingInfo?.userCode ?? null,
    verificationUri: pendingInfo?.verificationUri ?? null,
    expiresAt: pendingInfo?.expiresAt ?? null,
    message: lastError,
    persistent
  }
}

const push = (): void => broadcast(status())

// ------------------------------------------------------------- client id

/**
 * Never committed. Twitch calls this a public client id and it is not a secret,
 * but it identifies one person's registered application, and this is a public
 * repo — so it lives in the OS user data directory or an env var, never here.
 */
export async function loadClientId(): Promise<void> {
  const fromEnv = process.env.SLIPSTREAM_TWITCH_CLIENT_ID?.trim()
  if (fromEnv) {
    clientId = fromEnv
    return
  }
  try {
    clientId = (await readFile(clientIdPath(), 'utf8')).trim() || null
  } catch {
    clientId = null
  }
}

export async function setClientId(value: string): Promise<AuthStatus> {
  const trimmed = value.trim()
  if (!trimmed) return status()
  await mkdir(dirname(clientIdPath()), { recursive: true })
  await writeFile(clientIdPath(), trimmed, 'utf8')
  clientId = trimmed
  lastError = null
  push()
  return status()
}

export function getClientId(): string | null {
  return clientId
}

// --------------------------------------------------------------- storage

/**
 * Tokens are encrypted with the OS keystore (DPAPI on Windows). If the platform
 * cannot encrypt, we keep them in memory for the session and say so rather than
 * writing a bearer token to disk in the clear — an access token is a password.
 */
async function saveTokens(next: StoredTokens): Promise<void> {
  tokens = next
  if (!crypto.isAvailable()) {
    persistent = false
    return
  }
  try {
    await mkdir(dirname(tokenPath()), { recursive: true })
    await writeFile(tokenPath(), crypto.encrypt(JSON.stringify(next)))
    persistent = true
  } catch {
    persistent = false
  }
}

async function clearTokens(): Promise<void> {
  tokens = null
  await rm(tokenPath(), { force: true }).catch(() => undefined)
}

export async function restoreSession(): Promise<void> {
  if (!crypto.isAvailable()) {
    persistent = false
    return
  }
  try {
    const raw = await readFile(tokenPath())
    const parsed = JSON.parse(crypto.decrypt(raw)) as StoredTokens
    tokens = parsed
    // Refresh eagerly if it is close to expiry, so the first send does not fail.
    if (parsed.expiresAt - Date.now() < 10 * 60_000) await refresh()
  } catch {
    tokens = null
  }
}

// ------------------------------------------------------------------ http

async function form(url: string, fields: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(20_000)
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    // Twitch answers the device grant with {status, message}, not the RFC's
    // {error}. Poll states arrive as the message, so both are checked.
    const reason = String(body.message ?? body.error ?? res.status)
    throw Object.assign(new Error(reason), { reason })
  }
  return body
}

async function fetchUser(accessToken: string): Promise<TwitchUser> {
  const res = await fetch(HELIX_USERS, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId ?? '' },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`could not read your Twitch profile (${res.status})`)
  const body = (await res.json()) as {
    data?: { id: string; login: string; display_name: string }[]
  }
  const u = body.data?.[0]
  if (!u) throw new Error('Twitch returned no profile')
  return { id: u.id, login: u.login, display: u.display_name || u.login }
}

// ---------------------------------------------------------- device flow

export async function beginDeviceFlow(): Promise<AuthStatus> {
  if (!clientId) return status()
  cancelDeviceFlow()
  lastError = null

  try {
    const body = (await form(DEVICE_URL, { client_id: clientId, scopes: SCOPES })) as {
      device_code: string
      user_code: string
      verification_uri: string
      expires_in: number
      interval?: number
    }

    pendingInfo = {
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      expiresAt: Date.now() + body.expires_in * 1000
    }
    const session = { deviceCode: body.device_code, cancelled: false }
    polling = session
    push()

    void poll(session, Math.max(1, body.interval ?? 5) * 1000)
  } catch (err) {
    lastError = describe((err as Error).message)
    polling = null
    pendingInfo = null
    push()
  }
  return status()
}

function describe(reason: string): string {
  switch (reason) {
    case 'invalid client':
      return 'Twitch rejected that Client ID. Check it, and that the app has "Device Code Grant" as an OAuth redirect type.'
    case 'expired_token':
      return 'The code expired before it was entered. Start again.'
    case 'access_denied':
      return 'Sign-in was declined on Twitch.'
    default:
      return reason
  }
}

async function poll(session: { deviceCode: string; cancelled: boolean }, interval: number): Promise<void> {
  let wait = interval

  while (!session.cancelled) {
    await new Promise((r) => setTimeout(r, wait))
    if (session.cancelled) return

    if (pendingInfo && Date.now() > pendingInfo.expiresAt) {
      lastError = describe('expired_token')
      polling = null
      pendingInfo = null
      push()
      return
    }

    try {
      const body = (await form(TOKEN_URL, {
        client_id: clientId ?? '',
        device_code: session.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        scopes: SCOPES
      })) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string[] }

      const user = await fetchUser(body.access_token)
      await saveTokens({
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? null,
        expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
        user,
        scopes: body.scope ?? [...AUTH_SCOPES]
      })
      polling = null
      pendingInfo = null
      lastError = null
      push()
      return
    } catch (err) {
      const reason = (err as { reason?: string }).reason ?? (err as Error).message
      if (reason === 'authorization_pending') continue
      // The RFC asks for a longer gap after slow_down, not a retry storm.
      if (reason === 'slow_down') {
        wait += 5000
        continue
      }
      lastError = describe(reason)
      polling = null
      pendingInfo = null
      push()
      return
    }
  }
}

export function cancelDeviceFlow(): void {
  if (polling) polling.cancelled = true
  polling = null
  pendingInfo = null
  push()
}

// -------------------------------------------------------------- lifetime

export async function refresh(): Promise<boolean> {
  if (!tokens?.refreshToken || !clientId) return false
  try {
    const body = (await form(TOKEN_URL, {
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken
    })) as { access_token: string; refresh_token?: string; expires_in: number }

    await saveTokens({
      ...tokens,
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000
    })
    return true
  } catch {
    // A refresh token Twitch will not honour is worse than none: it makes every
    // later call fail silently. Drop the session and ask for a fresh sign-in.
    await clearTokens()
    lastError = 'Your Twitch session expired. Sign in again.'
    push()
    return false
  }
}

/** The token the IRC connection needs, refreshed if it is about to lapse. */
export async function accessToken(): Promise<{ token: string; login: string } | null> {
  if (!tokens) return null
  if (tokens.expiresAt - Date.now() < 5 * 60_000) {
    if (!(await refresh())) return null
  }
  return tokens ? { token: tokens.accessToken, login: tokens.user.login } : null
}

export async function validate(): Promise<boolean> {
  if (!tokens) return false
  try {
    const res = await fetch(VALIDATE_URL, {
      headers: { Authorization: `OAuth ${tokens.accessToken}` },
      signal: AbortSignal.timeout(15_000)
    })
    return res.ok
  } catch {
    return false
  }
}

export async function signOut(): Promise<AuthStatus> {
  cancelDeviceFlow()
  if (tokens && clientId) {
    // Best effort: a revoked token cannot be replayed if the file is recovered.
    await form(REVOKE_URL, { client_id: clientId, token: tokens.accessToken }).catch(() => undefined)
  }
  await clearTokens()
  lastError = null
  push()
  return status()
}

/** Test seam: reset module state between scenarios. */
export function __reset(): void {
  clientId = null
  tokens = null
  persistent = true
  polling = null
  pendingInfo = null
  lastError = null
}
