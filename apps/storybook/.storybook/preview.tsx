/**
 * Global Storybook config: the CSS pipeline, the theme/appearance toolbar, and
 * the decorators every story runs through.
 *
 * Two toolbar globals drive the two axes the app itself exposes:
 *   - `theme`      classic ⇄ shadcn  (the whole look)
 *   - `appearance` dark ⇄ light      (only meaningful in the modern theme)
 * Flip either from the toolbar to see every story in that combination.
 */

import type { Preview } from '@storybook/react-vite';

// The self-hosted modern fonts + the classic/modern CSS pipeline (see the file).
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './storybook.css';

import { withTheme, withSession } from './decorators';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    options: {
      storySort: {
        order: ['Introduction', 'Primitives', 'Bundles'],
      },
    },
  },
  globalTypes: {
    theme: {
      description: 'UI theme — the whole look',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'classic', title: 'Classic — PyMOL' },
          { value: 'shadcn', title: 'Modern — shadcn' },
        ],
        dynamicTitle: true,
      },
    },
    appearance: {
      description: 'Light/dark appearance (modern theme only)',
      toolbar: {
        title: 'Appearance',
        icon: 'mirror',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    // Open on the modern light target (the design the primitives are tuned for);
    // classic / dark are one toolbar click away.
    theme: 'shadcn',
    appearance: 'light',
  },
  decorators: [withSession, withTheme],
};

export default preview;
