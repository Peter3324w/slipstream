/**
 * A single, read-only liveness lookup against Twitch's public GraphQL endpoint.
 *
 * It exists for one reason: `streamlink` reports a channel that does not exist and
 * a channel that is simply offline with the identical message, "No playable streams
 * found on this URL". Showing "not live right now" for a typo sends you looking for
 * the wrong problem — which is precisely what a misremembered channel name already
 * cost once during this project.
 *
 * The client id below is the public web client's, visible in any browser's network
 * tab and the same one streamlink itself sends. It is not a credential, and nothing
 * here is authenticated: the query asks only whether a login resolves to a user.
 */
const GQL = 'https://gql.twitch.tv/gql'
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

/** Twitch's own persisted query for "is this channel live". */
const USE_LIVE_HASH = '639d5f11bfb8bf3053b424d9ef650d04c4ebb7d94711d644afb08fe9a0fad5d9'

export type Existence = 'live' | 'offline' | 'missing' | 'unknown'

export interface ChannelLookup {
  state: Existence
  /** Twitch's numeric user id. Third-party emote services key on this, not the login. */
  userId: string | null
}

/** Never throws. 'unknown' means the lookup failed and the caller should not care. */
export async function lookupChannel(login: string): Promise<ChannelLookup> {
  try {
    const res = await fetch(GQL, {
      method: 'POST',
      headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'UseLive',
        variables: { channelLogin: login },
        extensions: { persistedQuery: { version: 1, sha256Hash: USE_LIVE_HASH } }
      }),
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return { state: 'unknown', userId: null }

    const body = (await res.json()) as {
      data?: { user?: { id?: string; stream?: unknown } | null }
    }
    if (!('data' in body)) return { state: 'unknown', userId: null }
    const user = body.data?.user
    if (user === null) return { state: 'missing', userId: null }
    if (!user) return { state: 'unknown', userId: null }
    return { state: user.stream ? 'live' : 'offline', userId: user.id ?? null }
  } catch {
    return { state: 'unknown', userId: null }
  }
}

/** Convenience for callers that only care whether the channel exists. */
export async function channelExistence(login: string): Promise<Existence> {
  return (await lookupChannel(login)).state
}
