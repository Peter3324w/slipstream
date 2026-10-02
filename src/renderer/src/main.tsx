import { createRoot } from 'react-dom/client'
import App from './App'
import { restoreTheme } from './lib/themes'
import './styles/tokens.css'
import './styles/app.css'

// Before the first render, so the window never paints the default ground and
// then swaps it under someone who chose another one.
restoreTheme()

// No StrictMode: its deliberate double-invocation of effects would spawn two
// streamlink processes and two chat sockets per channel change.
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
