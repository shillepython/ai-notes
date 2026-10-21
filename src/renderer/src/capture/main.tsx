import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Capture from './Capture'
import './capture.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Capture />
  </StrictMode>
)
