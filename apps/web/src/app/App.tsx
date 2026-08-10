import { Suspense, lazy } from 'react';
import { BridgeProvider } from './BridgeProvider';
import { AppShell } from '../shell';
import { isRenderMode } from '../features/render/renderMode';

// The render harness is a rare `?render=1` path (the visual/perf suites) and it
// pulls in @tenmol/viewport + three.js. Load it LAZILY so the normal app — and
// every unit test that imports this module tree — does not eagerly resolve that
// subtree. `isRenderMode` comes straight from renderMode.ts (cheap, no viewport)
// so the branch decision stays synchronous.
const RenderStage = lazy(() =>
  import('../features/render/RenderStage').then((m) => ({ default: m.RenderStage })),
);

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
  return (
    <BridgeProvider>
      {isRenderMode() ? (
        <Suspense fallback={null}>
          <RenderStage />
        </Suspense>
      ) : (
        <AppShell />
      )}
    </BridgeProvider>
  );
}
