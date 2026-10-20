import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// On macOS the window has native vibrancy behind the sidebar (see main/index.ts).
if (navigator.platform.toLowerCase().includes('mac')) document.documentElement.classList.add('mac')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
