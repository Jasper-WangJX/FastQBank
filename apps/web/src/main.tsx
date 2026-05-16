import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// KaTeX stylesheet — imported once globally so every <Latex> render is
// styled (the component itself only injects KaTeX-generated HTML).
import 'katex/dist/katex.min.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
