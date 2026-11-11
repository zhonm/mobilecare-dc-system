import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import App from './App.jsx'
import { setupChunkLoadErrorListeners } from './utils/chunkLoadRecovery'

// Intercept chunk loading failures and Safari dynamic import script errors globally
setupChunkLoadErrorListeners()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <Analytics />
  </StrictMode>,
)
