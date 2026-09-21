import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/app.css'

// No StrictMode: its deliberate double-invocation of effects would spawn two
// streamlink processes and two chat sockets per channel change.
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
