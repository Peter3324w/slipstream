import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo, EmoteProvider, EmoteSet, MemorySample, ResolveResult } from '@shared/types'

/**
 * The entire main-process surface the renderer can reach. Deliberately tiny:
 * three read-only calls, no event emitters, nothing that takes a path or a URL.
 */
const api = {
  resolveChannel: (channel: string): Promise<ResolveResult> =>
    ipcRenderer.invoke('stream:resolve', channel),
  fetchEmotes: (channel: string, providers: EmoteProvider[]): Promise<EmoteSet> =>
    ipcRenderer.invoke('emotes:fetch', channel, providers),
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  memory: (): Promise<MemorySample[]> => ipcRenderer.invoke('app:memory')
}

export type SlipstreamApi = typeof api

contextBridge.exposeInMainWorld('slipstream', api)
