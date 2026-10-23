import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { parseWatchInput } from '@shared/channel'
import App from '../renderer/src/App'
import { ChevronRight, Palette, Play, Star } from '../renderer/src/components/Icons'
import { ThemePicker } from '../renderer/src/components/ThemePicker'
import { ChannelProfile } from '../renderer/src/components/ChannelProfile'

type Tab = 'home' | 'favourites' | 'appearance'
const SEARCH_USED_KEY = 'slipstream.mobileSearchUsed'

function SearchIcon(): React.JSX.Element {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" />
  </svg>
}

function HomeIcon(): React.JSX.Element {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z" />
  </svg>
}

export function MobileApp(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('home')
  const [watch, setWatch] = useState<string | null>(null)
  const [profileLogin, setProfileLogin] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [favourites, setFavourites] = useState<string[]>([])
  const [headerSearch, setHeaderSearch] = useState(false)
  const [searchUsed, setSearchUsed] = useState(() => {
    try { return localStorage.getItem(SEARCH_USED_KEY) === '1' } catch { return false }
  })
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (watch) return
    let active = true
    void window.slipstream.favourites.list().then((items) => {
      if (active) setFavourites(items)
    }).catch(() => { if (active) setError('Could not load your favourites. Please try again.') })
    return () => { active = false }
  }, [watch])

  const focusSearch = (): void => {
    // Mount the input before focusing it, still within the user's tap so the
    // phone can open its keyboard.
    flushSync(() => { setTab('home'); setHeaderSearch(true) })
    search.current?.focus()
  }
  const open = (input: string): void => {
    const target = parseWatchInput(input)
    if (!target) {
      setError('Enter a Twitch channel name or a twitch.tv video link.')
      search.current?.focus()
      return
    }
    setError('')
    setQuery(input.trim())
    setSearchUsed(true)
    setHeaderSearch(true)
    try { localStorage.setItem(SEARCH_USED_KEY, '1') } catch { /* Keep the session state when storage is unavailable. */ }
    if (target.kind === 'vod') setWatch(input.trim())
    else { setProfileLogin(target.login); setTab('home') }
  }

  if (watch) return <div className="mobile-player">
    <App initialWatch={watch} onHome={() => { setWatch(null); setTab('home') }} />
  </div>

  const showIntroSearch = !searchUsed && favourites.length === 0 && !headerSearch
  const searchForm = (inHeader: boolean): React.JSX.Element => <form
    className={`mobile-search${inHeader ? ' mobile-header-search' : ''}`} role="search"
    onSubmit={(event) => { event.preventDefault(); open(query) }}>
    <input ref={search} value={query} onChange={(event) => { setQuery(event.target.value); setError('') }}
      placeholder="Search Twitch" aria-label="Channel name or Twitch video link" aria-describedby={error ? 'mobile-search-error' : undefined}
      aria-invalid={!!error} type="search" enterKeyHint="search" autoComplete="off" autoCapitalize="none" spellCheck={false} />
    <button type="submit" aria-label="Search" disabled={!query.trim()}><SearchIcon /></button>
  </form>
  const favouriteChannels = <ul className="mobile-favourites">
    {favourites.map((login) => <li key={login}><button onClick={() => setWatch(login)}>
      <span className="mobile-channel-avatar" aria-hidden="true">{login[0].toUpperCase()}</span>
      <span>{login}</span><ChevronRight size={18} />
    </button></li>)}
  </ul>

  return (
    <div className={`mobile-shell${profileLogin && tab === 'home' ? ' has-profile' : ''}`}>
      <header className="mobile-header">
        <div className="mobile-brand"><span className="mobile-brand-mark" aria-hidden="true"><Play size={17} /></span>Slipstream</div>
        {headerSearch && tab === 'home' ? searchForm(true) : <button className="mobile-icon-button" aria-label="Search for a stream" onClick={focusSearch}><SearchIcon /></button>}
      </header>

      <main className="mobile-content">
        {error && <p id="mobile-search-error" className="mobile-error" role="alert">{error}</p>}
        {tab === 'home' && <>
          {showIntroSearch && <section className="mobile-search-area" aria-label="Find a stream">
            <div className="mobile-hero-mark" aria-hidden="true"><Play size={32} /></div>
            {searchForm(false)}
          </section>}
          {profileLogin ? <ChannelProfile key={profileLogin} login={profileLogin}
            favourites={favourites} onFavouritesChange={setFavourites}
            onWatchLive={() => setWatch(profileLogin)} onPickVod={(id) => setWatch(`videos/${id}`)} /> : favourites.length > 0 ? <section className="mobile-library">
              <h1>Favourites</h1>{favouriteChannels}
            </section> : <section className="mobile-get-started">
            <h1>{showIntroSearch ? 'Try searching to get started' : 'Find your next stream'}</h1>
            <p>{showIntroSearch ? 'Find a Twitch channel or paste a video link to start watching.' : 'Tap search in the top right to find a channel or open a Twitch video link.'}</p>
          </section>}
        </>}

        {tab === 'favourites' && <section className="mobile-library">
          <h1>Favourites</h1>
          {favourites.length ? favouriteChannels : <div className="mobile-empty">
            <span aria-hidden="true"><Star size={28} /></span>
            <h2>Your favourites belong here</h2>
            <p>Add a channel to favourites from the chat options while watching.</p>
            <button className="mobile-text-button" onClick={focusSearch}>Find a channel</button>
          </div>}
        </section>}

        {tab === 'appearance' && <section className="mobile-appearance">
          <h1>Appearance</h1>
          <p>Make Slipstream feel like yours.</p>
          <ThemePicker inline />
        </section>}
      </main>

      <nav className="mobile-navigation" aria-label="Main navigation">
        <button aria-current={tab === 'home' ? 'page' : undefined} onClick={() => setTab('home')}><HomeIcon /><span>Home</span></button>
        <button aria-current={tab === 'favourites' ? 'page' : undefined} onClick={() => setTab('favourites')}><Star size={22} /><span>Favourites</span></button>
        <button aria-current={tab === 'appearance' ? 'page' : undefined} onClick={() => setTab('appearance')}><Palette size={22} /><span>Appearance</span></button>
      </nav>
    </div>
  )
}
