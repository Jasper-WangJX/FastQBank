import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// KaTeX stylesheet — imported once globally so every <Latex> render is
// styled (the component itself only injects KaTeX-generated HTML).
import 'katex/dist/katex.min.css'
import App from './App.tsx'
import OverlayCapture from './pages/OverlayCapture.tsx'

// The Electron capture window loads this same build with ?overlay=1.
// Render ONLY the overlay then — no router, no AuthProvider, no chrome.
const isOverlay = new URLSearchParams(window.location.search).has('overlay')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOverlay ? <OverlayCapture /> : <App />}
  </StrictMode>,
)
