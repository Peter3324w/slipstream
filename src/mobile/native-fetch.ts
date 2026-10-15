import { CapacitorHttp } from '@capacitor/core'

/**
 * `fetch` for the code shared with Electron's main process, sent through Android's
 * own HTTP stack instead of the WebView's.
 *
 * On the desktop that code runs in Node, where CORS does not exist. In a WebView
 * it does, and gql.twitch.tv and usher answer with no access-control-allow-origin,
 * so a plain fetch could send the request and never read the answer. Going native
 * puts the shared modules back where they were written to run.
 *
 * Scoped on purpose: only these modules get it (see main.ts). Video never takes
 * this path - a 2s segment through the JS bridge would be copied as base64; the
 * playlists and segments are handled in MainActivity instead.
 */
export async function nativeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((value, key) => (headers[key] = value))

  let data: unknown = init.body ?? undefined
  // The JSON bodies are pre-stringified for Node's fetch; the plugin wants the value.
  if (typeof data === 'string' && /json/i.test(headers['content-type'] ?? '')) data = JSON.parse(data)

  const request = CapacitorHttp.request({
    url,
    method: init.method ?? 'GET',
    headers,
    data,
    responseType: 'text',
    connectTimeout: 15_000,
    readTimeout: 20_000
  })

  // The callers pass AbortSignal.timeout(); the plugin cannot be cancelled, but the
  // caller can stop waiting for it, which is all the timeout is for.
  const signal = init.signal
  const res = await (signal
    ? Promise.race([
        request,
        new Promise<never>((_, reject) => {
          if (signal.aborted) reject(signal.reason)
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      ])
    : request)

  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
  return new Response(res.status === 204 || res.status === 304 ? null : body, {
    status: res.status,
    headers: res.headers
  })
}
