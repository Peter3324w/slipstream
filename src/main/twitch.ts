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
import type { ChannelSummary, VodChatMessage, VodChatPage, VodSummary } from '@shared/types'

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

interface VideoNode {
  id?: string
  title?: string
  lengthSeconds?: number
  createdAt?: string
  viewCount?: number
  self?: { isRestricted?: boolean } | null
}

interface VideoConnection {
  edges?: { node?: VideoNode }[]
}

function toSummaries(conn: VideoConnection | null | undefined, kind: VodSummary['kind']): VodSummary[] {
  const out: VodSummary[] = []
  for (const edge of conn?.edges ?? []) {
    const n = edge?.node
    if (!n?.id) continue
    const created = n.createdAt ? Date.parse(n.createdAt) : NaN
    out.push({
      id: n.id,
      title: n.title ?? '',
      length: n.lengthSeconds ?? 0,
      createdAt: Number.isNaN(created) ? 0 : created,
      views: n.viewCount ?? 0,
      restricted: n.self?.isRestricted === true,
      kind
    })
  }
  return out
}

/**
 * A channel's recent broadcasts, newest first, with highlights behind them.
 *
 * Archives are the list. A highlight is someone's edit rather than the stream
 * that was missed, so it does not get to sit among them unlabelled — but
 * ARCHIVE-only was wrong in the case that actually turns up: a channel that
 * stopped saving broadcasts still publishes highlights, and the screen then
 * offered a month-old archive while saying nothing about the clip from last
 * week. Measured on `faide` (2026-10-02): newest archive 25 days old, newest
 * highlight 11 days old, nothing restricted. The broadcasts were never stored —
 * no client can fetch what Twitch was never given.
 *
 * The rule is a comparison rather than a number of days: a highlight is only
 * offered when it is NEWER than the newest archive. A channel with fresh
 * archives therefore shows none and stays uncluttered, a channel with no
 * archives at all shows them all, and there is no threshold to tune.
 *
 * One request with two aliases rather than two round trips. Raw query rather
 * than a persisted hash, for the reason above the favourites query - the hashes
 * rotate, a field list does not.
 *
 * Never throws. "Not live" is already a disappointment; it does not need an
 * error on top of it, so a failed lookup is simply an empty list.
 */
export async function channelVods(login: string, first = 8): Promise<VodSummary[]> {
  try {
    const res = await fetch(GQL, {
      method: 'POST',
      headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query Vods($login: String!, $first: Int!) {
  user(login: $login) {
    archive: videos(first: $first, sort: TIME, type: ARCHIVE) {
      edges { node { id title lengthSeconds createdAt viewCount self { isRestricted } } }
    }
    highlight: videos(first: $first, sort: TIME, type: HIGHLIGHT) {
      edges { node { id title lengthSeconds createdAt viewCount self { isRestricted } } }
    }
  }
}`,
        variables: { login, first }
      }),
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return []

    const body = (await res.json()) as {
      data?: {
        user?: {
          archive?: VideoConnection | null
          highlight?: VideoConnection | null
        } | null
      }
    }

    const archives = toSummaries(body.data?.user?.archive, 'archive')
    // 0 when there are no archives, so every highlight clears the bar — which is
    // exactly the channel that needs them.
    const newestArchive = archives.reduce((max, v) => Math.max(max, v.createdAt), 0)
    const highlights = toSummaries(body.data?.user?.highlight, 'highlight').filter(
      (v) => v.createdAt > newestArchive
    )

    return [...archives, ...highlights]
  } catch {
    return []
  }
}

interface CommentFragment {
  text?: string
  emote?: { emoteID?: string } | null
}

/**
 * Chat as it was said, for one window of a VOD.
 *
 * **Paging is by offset, and the caller must deduplicate by id.** Twitch's own
 * player pages with a cursor, but `after:` is refused with `IntegrityCheckFailed`
 * for an anonymous client - with a raw query *and* with Twitch's own persisted
 * hash, so it wants a Client-Integrity token rather than a different query. Asking
 * by offset works and keeps working; it just returns a page that begins about a
 * second before the offset asked for, so consecutive pages overlap. Measured on a
 * hype moment in an esports VOD: 58 returned, 35 already seen, 23 new. In a calm
 * stretch the same page covers 50-100s and the overlap is a rounding error.
 *
 * `first` is capped at 100 by the server and ignored in practice: every page came
 * back 57-59 long regardless.
 *
 * Never throws: `failed` says the lookup broke, which is not the same as the VOD
 * having no more chat, and the caller must not treat it as the end.
 */
export async function vodComments(videoId: string, offsetSeconds: number): Promise<VodChatPage> {
  const offset = Math.max(0, Math.floor(offsetSeconds))
  const empty: VodChatPage = { messages: [], nextOffset: offset, hasMore: true, bytes: 0, failed: true }

  try {
    const res = await fetch(GQL, {
      method: 'POST',
      headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query VodChat($id: ID!, $offset: Int!) {
  video(id: $id) {
    comments(contentOffsetSeconds: $offset) {
      edges {
        node {
          id
          contentOffsetSeconds
          commenter { login displayName }
          message { userColor fragments { text emote { emoteID } } }
        }
      }
      pageInfo { hasNextPage }
    }
  }
}`,
        variables: { id: videoId, offset }
      }),
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return empty

    // Read as text first: the payload size is the number worth reporting, and
    // content-length is absent on a chunked response.
    const raw = await res.text()
    const bytes = Buffer.byteLength(raw)
    const body = JSON.parse(raw) as {
      data?: {
        video?: {
          comments?: {
            edges?: {
              node?: {
                id?: string
                contentOffsetSeconds?: number
                commenter?: { login?: string; displayName?: string } | null
                message?: { userColor?: string | null; fragments?: CommentFragment[] } | null
              }
            }[]
            pageInfo?: { hasNextPage?: boolean }
          } | null
        } | null
      }
      errors?: unknown
    }
    if (body.errors || !body.data?.video) return { ...empty, bytes }

    const comments = body.data.video.comments
    const messages: VodChatMessage[] = []
    for (const edge of comments?.edges ?? []) {
      const n = edge?.node
      if (!n?.id) continue
      // A deleted account leaves its messages behind with no commenter.
      const login = n.commenter?.login ?? ''
      messages.push({
        id: n.id,
        offset: n.contentOffsetSeconds ?? 0,
        login,
        display: n.commenter?.displayName ?? login ?? 'unknown',
        color: n.message?.userColor ?? null,
        ...assemble(n.message?.fragments ?? [])
      })
    }

    const last = messages[messages.length - 1]
    return {
      messages,
      // Not last.offset + 1: a second can hold more messages than one page, and
      // skipping past it would drop them. The overlap is the caller's to dedupe.
      nextOffset: last ? last.offset : offset,
      hasMore: comments?.pageInfo?.hasNextPage !== false,
      bytes,
      failed: false
    }
  } catch {
    return empty
  }
}

/**
 * Fragments to the shape the log already draws: one body string plus emote ranges.
 *
 * The ranges are in **code points**, because that is what the renderer indexes by -
 * it has to be, since Twitch's IRC tag is in code points and any message with an
 * emoji would otherwise draw its emotes in the wrong place. `[...text].length` is
 * the length that matters here, never `text.length`.
 *
 * Exported for its own sake: this is a function with one trap in it, and a real
 * VOD will not reliably hand you a message with an emoji *and* a Twitch emote to
 * prove it on. Synthetic input does, in a millisecond.
 */
export function assemble(fragments: CommentFragment[]): {
  body: string
  emotes: VodChatMessage['emotes']
} {
  let body = ''
  let cursor = 0
  const emotes: VodChatMessage['emotes'] = []

  for (const f of fragments) {
    const text = f.text ?? ''
    const length = [...text].length
    if (f.emote?.emoteID && length)
      emotes.push({ id: f.emote.emoteID, start: cursor, end: cursor + length - 1 })
    body += text
    cursor += length
  }
  return { body, emotes }
}

export interface VodInfo {
  /** The broadcaster's login - not derivable from a display name, which may be
      in another script entirely (a channel displaying as kanji still has an
      ASCII login, and lowercasing the display name would invent a channel). */
  login: string
  display: string
  title: string
  category: string
  lengthSeconds: number | null
  recordedAt: number | null
  /** Sub-only, or otherwise not ours to play. */
  restricted: boolean
}

/**
 * What Twitch knows about one VOD. Never throws: playback does not depend on it,
 * so a failed lookup costs a nicer header and nothing else.
 *
 * A raw query rather than a persisted hash, for the reason given above the
 * favourites query: the hashes rotate, a field list does not.
 */
export async function vodInfo(id: string): Promise<VodInfo | null> {
  try {
    const res = await fetch(GQL, {
      method: 'POST',
      headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query Vod($id: ID!) {
  video(id: $id) {
    title lengthSeconds createdAt
    game { displayName }
    owner { login displayName }
    self { isRestricted }
  }
}`,
        variables: { id }
      }),
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return null

    const body = (await res.json()) as {
      data?: {
        video?: {
          title?: string
          lengthSeconds?: number
          createdAt?: string
          game?: { displayName?: string } | null
          owner?: { login?: string; displayName?: string } | null
          self?: { isRestricted?: boolean } | null
        } | null
      }
    }
    const v = body.data?.video
    if (!v?.owner?.login) return null

    const recorded = v.createdAt ? Date.parse(v.createdAt) : NaN
    return {
      login: v.owner.login,
      display: v.owner.displayName ?? v.owner.login,
      title: v.title ?? '',
      category: v.game?.displayName ?? '',
      lengthSeconds: typeof v.lengthSeconds === 'number' ? v.lengthSeconds : null,
      recordedAt: Number.isNaN(recorded) ? null : recorded,
      restricted: v.self?.isRestricted === true
    }
  } catch {
    return null
  }
}

/** Convenience for callers that only care whether the channel exists. */
export async function channelExistence(login: string): Promise<Existence> {
  return (await lookupChannel(login)).state
}

/**
 * Live status for a list of channels, in as few requests as possible.
 *
 * Deliberately a raw query rather than one of Twitch's persisted-query hashes.
 * The hashes are undocumented and get rotated; a query string that asks for
 * exactly these fields keeps working, and it returns name, avatar, game, title
 * and viewers together where UseLive only says live or not.
 *
 * Verified: 23 logins in a single request.
 */
const SUMMARY_QUERY = `query Favourites($logins: [String!]) {
  users(logins: $logins) {
    login
    displayName
    profileImageURL(width: 50)
    stream { viewersCount game { displayName } }
    broadcastSettings { title }
  }
}`

/** Conservative: 23 was fine, but a long list should not ride on one request. */
const BATCH = 25

interface GqlUser {
  login: string
  displayName?: string
  profileImageURL?: string
  stream?: { viewersCount?: number; game?: { displayName?: string } | null } | null
  broadcastSettings?: { title?: string } | null
}

export async function channelSummaries(logins: string[]): Promise<ChannelSummary[]> {
  if (!logins.length) return []

  const chunks: string[][] = []
  for (let i = 0; i < logins.length; i += BATCH) chunks.push(logins.slice(i, i + BATCH))

  const found = new Map<string, ChannelSummary>()
  /** Logins whose batch never answered. Unknown, not missing. */
  const unchecked = new Set<string>()

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await fetch(GQL, {
          method: 'POST',
          headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: SUMMARY_QUERY, variables: { logins: chunk } }),
          signal: AbortSignal.timeout(15_000)
        })
        if (!res.ok) {
          chunk.forEach((login) => unchecked.add(login))
          return
        }

        const body = (await res.json()) as { data?: { users?: (GqlUser | null)[] } }
        for (const user of body.data?.users ?? []) {
          // A null entry means Twitch does not know that login at all.
          if (!user?.login) continue
          const stream = user.stream
          found.set(user.login.toLowerCase(), {
            login: user.login.toLowerCase(),
            display: user.displayName || user.login,
            avatar: user.profileImageURL ?? null,
            live: Boolean(stream),
            viewers: stream?.viewersCount ?? null,
            game: stream?.game?.displayName ?? null,
            title: user.broadcastSettings?.title ?? null,
            exists: true
          })
        }
      } catch {
        // A failed batch leaves those channels unknown rather than failing the lot.
        chunk.forEach((login) => unchecked.add(login))
      }
    })
  )

  // Preserve the caller's order, and keep channels Twitch did not return so the
  // list does not silently lose a typo'd entry the user can still delete.
  return logins.map(
    (login) =>
      found.get(login.toLowerCase()) ?? {
        login,
        display: login,
        avatar: null,
        live: false,
        viewers: null,
        game: null,
        title: null,
        exists: unchecked.has(login) ? null : false
      }
  )
}
