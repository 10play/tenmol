import { BridgeProvider } from './BridgeProvider';
import { AppShell } from '../shell';
import { RenderStage, isRenderMode } from '../features/render/RenderStage';

/**
 * The application: a provider and a shell.
 *
 * `?render=1` swaps the whole shell for the bare {@link RenderStage} (just the
 * WebGL canvas) — used by the visual/performance regression suites. Both live
 * under the same {@link BridgeProvider}, so the render harness gets the same
 * `?backend=local` session. Everything else arrives through the feature registry
 * (`src/features/registry.ts`), so this file does not change as features land.
 */
export default function App() {
  return <BridgeProvider>{isRenderMode() ? <RenderStage /> : <AppShell />}</BridgeProvider>;
}
