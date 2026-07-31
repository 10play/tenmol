import { BridgeProvider } from './BridgeProvider';
import { AppShell } from '../shell';

/**
 * The application: a provider and a shell.
 *
 * Everything else arrives through the feature registry
 * (`src/features/registry.ts`), so this file does not change as features land.
 */
export default function App() {
  return (
    <BridgeProvider>
      <AppShell />
    </BridgeProvider>
  );
}
