/**
 * Renders one registry slot: lazily, isolated, and honest when it is empty.
 *
 * `React.lazy` is memoised per id at module scope — creating it inside the
 * component would remount the feature on every parent render.
 */

import { Suspense, lazy, type ComponentType } from 'react';
import { getSlot, isInstalled, loadFeature } from '../features/registry';
import { useSession } from '../app';
import { ErrorBoundary } from './ErrorBoundary';

const CACHE = new Map<string, ComponentType>();

function componentFor(id: string): ComponentType | null {
  const cached = CACHE.get(id);
  if (cached) return cached;
  const loader = loadFeature(id);
  if (!loader) return null;
  const Lazy = lazy(async () => {
    const mod = await loader();
    const feature = mod.default;
    if (!feature || typeof feature.Panel !== 'function') {
      throw new Error(`features/${id}/register.ts must default-export { id, Panel }`);
    }
    if (feature.id !== id) {
      throw new Error(`features/${id}/register.ts declares id "${feature.id}"`);
    }
    return { default: feature.Panel };
  });
  CACHE.set(id, Lazy);
  return Lazy;
}

export function FeatureSlot({ id, className }: { id: string; className?: string }) {
  const session = useSession();
  const slot = getSlot(id);
  const Panel = componentFor(id);

  if (!Panel) {
    // Not installed. Slots whose `absent` note is empty stay silent (a wizard
    // panel is *supposed* to be invisible most of the time); the rest say so.
    if (!slot?.absent) return null;
    return (
      <div className={`feature-absent ${className ?? ''}`}>
        <span className="feature-absent__title">{slot.absent}</span>
        <span className="feature-absent__owner">{slot.owner}</span>
      </div>
    );
  }

  return (
    <ErrorBoundary
      label={slot?.title ?? id}
      onError={(error) =>
        session.stores.feedback.appendClient(` feature "${id}" crashed: ${error.message}`, 'error')
      }
    >
      <Suspense fallback={<div className={`feature-loading ${className ?? ''}`}>loading…</div>}>
        <Panel />
      </Suspense>
    </ErrorBoundary>
  );
}

/** True when every id given has a directory. Used by the shell for layout. */
export function anyInstalled(ids: readonly string[]): boolean {
  return ids.some(isInstalled);
}
