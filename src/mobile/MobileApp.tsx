import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { parseWatchInput } from '@shared/channel'
import App from '../renderer/src/App'
import { ChevronRight, Palette, Play, Star } from '../renderer/src/components/Icons'
import { ThemePicker } from '../renderer/src/components/ThemePicker'

type Tab = 'home' | 'favourites' | 'appearance'

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
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [favourites, setFavourites] = useState<string[]>([])
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
    flushSync(() => setTab('home'))
    search.current?.focus()
  }
  const open = (input: string): void => {
    if (!parseWatchInput(input)) {
      setError('Enter a Twitch channel name or a twitch.tv video link.')
      search.current?.focus()
      return
    }
    setError('')
    setWatch(input.trim())
  }

  if (watch) return <div className="mobile-player">
    <App initialWatch={watch} onHome={() => { setWatch(null); setTab('home') }} />
  </div>

  return (
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="mobile-brand"><span className="mobile-brand-mark" aria-hidden="true"><Play size={17} /></span>Slipstream</div>
        <button className="mobile-icon-button" aria-label="Search for a stream" onClick={focusSearch}><SearchIcon /></button>
      </header>

      <main className="mobile-content">
        {tab === 'home' && <>
          <section className="mobile-search-area" aria-label="Find a stream">
            <div className="mobile-hero-mark" aria-hidden="true"><Play size={32} /></div>
            <form className="mobile-search" role="search" onSubmit={(event) => { event.preventDefault(); open(query) }}>
              <input ref={search} value={query} onChange={(event) => { setQuery(event.target.value); setError('') }}
                placeholder="Search Twitch" aria-label="Channel name or Twitch video link" aria-describedby={error ? 'mobile-search-error' : undefined}
                aria-invalid={!!error} type="search" enterKeyHint="search" autoComplete="off" autoCapitalize="none" spellCheck={false} />
              <button type="submit" aria-label="Search" disabled={!query.trim()}><SearchIcon /></button>
            </form>
            {error && <p id="mobile-search-error" className="mobile-error" role="alert">{error}</p>}
          </section>
          <section className="mobile-get-started">
            <h1>Try searching to get started</h1>
            <p>Find a Twitch channel or paste a video link to start watching.</p>
          </section>
        </>}

        {tab === 'favourites' && <section className="mobile-library">
          <h1>Favourites</h1>
          {favourites.length ? <ul className="mobile-favourites">
            {favourites.map((login) => <li key={login}><button onClick={() => open(login)}>
              <span className="mobile-channel-avatar" aria-hidden="true">{login[0].toUpperCase()}</span>
              <span>{login}</span><ChevronRight size={18} />
            </button></li>)}
          </ul> : <div className="mobile-empty">
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
