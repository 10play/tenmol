import { BridgeProvider } from './BridgeProvider';
import { AppShell } from '../shell';
import { ThemeProvider } from '../ui/theme';

/**
 * The application: a theme, a provider and a shell.
 *
 * `ThemeProvider` is the swap seam — it resolves `classic` vs `shadcn` (URL
 * param > localStorage > `classic`) and every `src/ui` primitive reads it. It
 * wraps the whole tree so the toggle in the shell header can flip the look live.
 * Everything else arrives through the feature registry
 * (`src/features/registry.ts`), so this file does not change as features land.
 */
export default function App() {
  return (
    <ThemeProvider>
      <BridgeProvider>
        <AppShell />
      </BridgeProvider>
    </ThemeProvider>
  );
}
