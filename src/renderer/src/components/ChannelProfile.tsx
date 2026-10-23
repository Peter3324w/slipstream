import { useEffect, useState } from 'react'
import type { ChannelSummary } from '@shared/types'
import { VodList } from './VodList'

interface Props {
  login: string
  onWatchLive: () => void
  onPickVod: (id: string) => void
  favourites: string[]
  onFavouritesChange: (items: string[]) => void
}

export function ChannelProfile({ login, onWatchLive, onPickVod, favourites, onFavouritesChange }: Props): React.JSX.Element {
  const [profile, setProfile] = useState<ChannelSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const favourite = favourites.includes(login)

  const toggleFavourite = async (): Promise<void> => {
    setSaving(true)
    setSaveError('')
    try {
      const items = await (favourite ? window.slipstream.favourites.remove(login) : window.slipstream.favourites.add(login))
      onFavouritesChange(items)
    } catch {
      setSaveError('Could not update favourites. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    let active = true
    setProfile(null)
    setLoading(true)
    void window.slipstream.favourites.summaries([login]).then((rows) => {
      if (active) setProfile(rows[0] ?? null)
    }).catch(() => {}).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [login, attempt])

  return <section className="channel-profile" aria-label={`${login} profile`}>
    <header className="channel-profile-header">
      <div className="channel-profile-avatar" aria-hidden="true">
        {profile?.avatar && failedAvatar !== profile.avatar
          ? <img src={profile.avatar} alt="" onError={() => setFailedAvatar(profile.avatar)} />
          : login.slice(0, 1).toUpperCase()}
      </div>
      <div className="channel-profile-identity">
        <h1>{profile?.display || login}</h1>
        <p>{loading ? 'Loading channel…' : profile?.exists === false ? 'Channel not found' : profile?.exists !== true ? 'Could not load channel details' : profile.live ? 'Live now' : 'Offline'}</p>
      </div>
      {profile?.exists === true && <div className="channel-profile-actions">
        {profile.live && <button className="btn channel-watch-live" onClick={onWatchLive}>Watch live</button>}
        <button className="btn channel-favourite" aria-pressed={favourite} disabled={saving}
          title={favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void toggleFavourite()}>
          {saving ? 'Saving…' : favourite ? 'Added to favourites' : 'Add to favourites'}
        </button>
      </div>}
    </header>
    {saveError && <p className="channel-profile-error" role="alert">{saveError}</p>}
    {!loading && profile?.exists !== true && <button className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>}
    {profile?.exists === true && <VodList key={login} login={login} onPick={onPickVod} />}
  </section>
}
