import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/global.css';
// After global.css: Tailwind's utilities live in `@layer utilities`, which the
// unlayered classic stylesheet always outranks. See styles/tailwind.css.
import './styles/tailwind.css';
// The modern theme. Every rule is scoped to `[data-ui-theme='shadcn']`, so it is
// inert until the ThemeProvider stamps that attribute. See styles/shadcn.css.
import './styles/shadcn.css';

/**
 * Entry point.
 *
 * StrictMode is on: the session is a module singleton (`app/session.ts`), so the
 * deliberate double-mount opens exactly one socket, sends exactly one `sub` per
 * topic and starts exactly one poll loop. If that ever stops being true,
 * StrictMode is the thing that will catch it in development instead of a user
 * catching it in production.
 */
const container = document.getElementById('root');
if (!container) throw new Error('#root not found in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
