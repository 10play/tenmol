# @tenmol/stores

Client state for the PyMOL web client. ~700 lines of plain TypeScript, one
dependency (`@tenmol/protocol`, types only), no framework, no state library.

```
createStore.ts    the whole "state library": get / set / subscribe, immutable
                  snapshots, stable identity between sets
poll.ts           the §1.5 state tick: 30 Hz focused, 4 Hz hidden, never
                  overlapping, kickable
bridgeBinding.ts  topic -> store with sequence-gap detection, and the
                  `invalidates` reader
connection.ts     transport + engine state, told honestly (4401/4403 are their
                  own terminal phases, not "closed")
feedback.ts       the console scrollback: classification, the 5,000-line ring,
                  and the replay-on-resubscribe dedupe
objects.ts        object-panel rows (pure builders + the store)
objectsSource.ts  the two-RPC poll pass and every mutation the panel issues
ui.ts             local-only UI state, persisted to localStorage
```

## Adding your store

**Do not edit `src/index.ts`.** Add `src/<yourStore>.ts` and let consumers
import it by subpath:

```ts
import { createViewStore } from '@tenmol/stores/view';
```

`package.json` (`"./*": "./src/*.ts"`) and `tsconfig.base.json`
(`"@tenmol/stores/*"`) already resolve that. The barrel is frozen precisely so
that eleven work packages do not queue up behind one shared file (plan §5.2).

Plan §6 assigns the remaining stores: `view.ts` WP-09, `selection.ts` WP-10,
`settings.ts` WP-15, `wizard.ts` WP-16, `editor.ts` WP-17, `dialog.ts` WP-18,
`movie.ts`/`scenes.ts` WP-20, `seqview.ts` WP-21, `colors.ts` WP-22,
`plugin.ts` WP-25, `geometry.ts` WP-26.

## Two rules

1. **Nothing is optimistic except `ui.ts`.** Every PyMOL mutation is
   round-tripped: a settings write can silently no-op at the wrong level,
   `SettingGenerateSideEffects` can invalidate geometry, and the object panel
   has no push feed at all, so the truth is the next poll or the next topic
   event — never what the UI just asked for.
2. **No React in this package.** The binding lives in
   `apps/web/src/app/hooks.ts`. Everything here is therefore testable under
   vitest's node environment with no DOM: `pnpm --filter @tenmol/stores test`.

## Test

```
$ node node_modules/vitest/vitest.mjs run packages/stores/test
 ✓ |node| packages/stores/test/stores.test.ts (33 tests)
```
