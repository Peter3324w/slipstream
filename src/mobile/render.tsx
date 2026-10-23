import { createRoot } from 'react-dom/client'
import { restoreAppearance } from '../renderer/src/lib/themes'
import { MobileApp } from './MobileApp'
import '../renderer/src/styles/tokens.css'
import '../renderer/src/styles/app.css'
import './mobile.css'

restoreAppearance()
createRoot(document.getElementById('root') as HTMLElement).render(<MobileApp />)
