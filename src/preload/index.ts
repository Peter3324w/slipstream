import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  AuthStatus,
  ChannelSummary,
  EmoteProvider,
  EmoteSet,
  MemorySample,
  ResolveResult,
  VodChatPage,
  VodSummary
} from '@shared/types'

/**
 * The entire main-process surface the renderer can reach. Deliberately tiny:
 * Named operations only; no arbitrary IPC channels or window methods exposed.
 */
const api = {
  /** A channel name, a twitch.tv link, or a twitch.tv/videos/<id> VOD link. */
  resolve: (input: string): Promise<ResolveResult> => ipcRenderer.invoke('stream:resolve', input),
  /** Playback stopped: drop the CORS grant a VOD needed (see main/vod-access.ts). */
  release: (): Promise<void> => ipcRenderer.invoke('stream:release'),
  /** One window of a VOD's recorded chat. Paged by offset; dedupe by id. */
  vodComments: (id: string, offset: number): Promise<VodChatPage> =>
    ipcRenderer.invoke('vod:comments', id, offset),
  /** A channel's recent past broadcasts, newest first. Empty if the lookup failed. */
  vods: (login: string): Promise<VodSummary[]> => ipcRenderer.invoke('channels:vods', login),
  fetchEmotes: (channel: string, providers: EmoteProvider[]): Promise<EmoteSet> =>
    ipcRenderer.invoke('emotes:fetch', channel, providers),
  favourites: {
    list: (): Promise<string[]> => ipcRenderer.invoke('favourites:list'),
    add: (login: string): Promise<string[]> => ipcRenderer.invoke('favourites:add', login),
    remove: (login: string): Promise<string[]> => ipcRenderer.invoke('favourites:remove', login),
    summaries: (logins: string[]): Promise<ChannelSummary[]> =>
      ipcRenderer.invoke('channels:summaries', logins)
  },

  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),

  windowControls: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggleMaximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    onMaximized: (cb: (maximized: boolean) => void): (() => void) => {
      const handler = (_event: unknown, maximized: boolean): void => cb(maximized)
      ipcRenderer.on('window:maximized', handler)
      return () => ipcRenderer.removeListener('window:maximized', handler)
    }
  },

  auth: {
    status: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:status'),
    begin: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:begin'),
    cancel: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:cancel'),
    signOut: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:signOut'),
    setClientId: (value: string): Promise<AuthStatus> =>
      ipcRenderer.invoke('auth:setClientId', value),
    /** Fetched per connect and never retained in the renderer. */
    chatCredentials: (): Promise<{ token: string; login: string } | null> =>
      ipcRenderer.invoke('auth:chatCredentials'),
    /** Returns an unsubscribe function. */
    onChanged: (cb: (status: AuthStatus) => void): (() => void) => {
      const handler = (_e: unknown, status: AuthStatus): void => cb(status)
      ipcRenderer.on('auth:changed', handler)
      return () => ipcRenderer.removeListener('auth:changed', handler)
    }
  },
  memory: (): Promise<MemorySample[]> => ipcRenderer.invoke('app:memory')
}

export type SlipstreamApi = typeof api

contextBridge.exposeInMainWorld('slipstream', api)
