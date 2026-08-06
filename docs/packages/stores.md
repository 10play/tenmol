---
title: "@tenmol/stores"
description: "Client state for the PyMOL web client. ~2,950 lines of plain TypeScript, one dependency (@tenmol/protocol, types only), no framework and no state library."
---

# @tenmol/stores

Client state for the PyMOL web client. ~2,950 lines of plain TypeScript, one
dependency (`@tenmol/protocol`, types only), no framework and no state library.

```
createStore.ts    the whole "state library": get / set / subscribe, immutable
                  snapshots, stable identity between sets
poll.ts           the state tick: 30 Hz focused, 4 Hz hidden, never overlapping,
                  silent while disabled, kickable
bridgeBinding.ts  topic -> store, with sequence-gap detection and the
                  `invalidates` reader
connection.ts     transport + engine state, told honestly (4401 and 4403 are
                  their own terminal phases, not "closed"; `degraded` and
                  `headless` come from the bridge's `hello`)
feedback.ts       the External-GUI scrollback: classification, the ring, and the
                  replay-on-resubscribe overlap dedupe
console.ts        PyMOL's OWN in-viewport console: a 256-line ring, a 256-entry
                  history ring, and a port of Ortho.cpp's line editor
objects.ts        object-panel rows (pure builders + the store)
objectsSource.ts  the two-RPC poll pass and every mutation the panel issues
settings.ts       the settings catalogue, the cursor-addressed change tap, and
                  the read-back-after-write path
ui.ts             local-only UI state, persisted to localStorage
```

## Importing

The barrel (`src/index.ts`) exports `createStore`, `bridgeBinding`, `poll`,
`connection`, `feedback`, `objects`, `objectsSource` and `ui`. It is **frozen**
— `console.ts` and `settings.ts` are deliberately not in it, and neither is
anything you add. Reach a store by subpath:

```ts
import { createSettingsStore } from '@tenmol/stores/settings';
import { createConsoleStore } from '@tenmol/stores/console';
```

`package.json` (`"./*": "./src/*.ts"`) and `tsconfig.base.json`
(`"@tenmol/stores/*"`) already resolve that, so adding `src/<yourStore>.ts` is
the entire installation step and no shared file is edited.

## Three things to know before you change anything here

**1. Nothing is optimistic except `ui.ts`.** Every PyMOL mutation is
round-tripped. A settings write can silently no-op at the wrong level,
`SettingGenerateSideEffects` can invalidate geometry, and the object panel has
no push feed at all — so the truth is always the next poll or the next topic
event, never what the UI just asked for. `ui.ts` is exempt because none of it is
PyMOL state.

**2. Gap detection in `bridgeBinding.ts` is currently INERT, on purpose.**
`EventMessage.seq` is monotonic per topic per connection, but
`packages/client/src/connection.ts` forwards `message.payload` and drops
`message.seq` on the floor. So every binding runs with `seq === undefined` and
reports `seqAvailable: false` rather than pretending everything is fine. The
moment the client forwards `seq`, `bind()` starts working with no change here.

**3. No React in this package.** The binding is `apps/web/src/app/hooks.ts`.
Everything here is therefore testable under vitest's node environment with no
DOM — which is the reason the split exists.

## Tests

```bash
pnpm --filter @tenmol/stores test    # 33 tests, packages/stores/test/stores.test.ts
```

That covers the machinery and the stores the barrel exports. **`console.ts` and
`settings.ts` are tested from the app**, in
`apps/web/src/features/console/**` and `apps/web/src/features/settings/**`
(214 tests between them), because their tests exercise the store together with
the feature that wires it. Changing either of those two files and running only
`--filter @tenmol/stores` will tell you nothing; run `pnpm test`.
