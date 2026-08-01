/**
 * Slot `wizards`, region `internal-gui`. Plan §6 WP-16.
 *
 * Composition, top to bottom:
 *   <WizardLauncher/>   the Qt Wizard menu, fed by `wizards.catalog`
 *   <WizardPanel/>      `get_panel()` rows — the generic renderer
 *   <WizardKeyCapture/> `do_key` for the line-editor wizards, mask-gated
 *   <WizardEventBridge/> the pick/select seam until WP-10's ray pick lands
 *   <WizardPrompt/>     `get_prompt()`, portalled over the viewport
 *
 * Nothing here knows anything about any individual wizard. Everything a wizard
 * shows comes out of the snapshot, and everything a wizard is told goes back as
 * an opaque `code` string or a masked event.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WIZARD_EVENT_BITS, type WizardCatalog, type WizardEventKind } from '@tenmol/protocol';
import { useSession, useStore } from '../../app';
import { createWizardService, type WizardEventPayload } from './service';
import { useWizard } from './useWizard';
import { WizardPanel } from './WizardPanel';
import { WizardPrompt } from './WizardPrompt';
import { WizardLauncher } from './WizardLauncher';
import { WizardKeyCapture } from './WizardKeyCapture';
import './wizards.css';

export function WizardsPanel() {
  const session = useSession();
  const phase = useStore(session.stores.connection, (s) => s.phase);
  const connected = phase === 'open';

  const service = useMemo(
    () => createWizardService((fn, args, kwargs) => session.call(fn, args, kwargs)),
    [session],
  );

  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  const { snapshot, error, kick } = useWizard({
    service,
    isEnabled: () => connectedRef.current,
  });

  const [catalog, setCatalog] = useState<WizardCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || catalog) return;
    let cancelled = false;
    service
      .catalog()
      .then((value) => {
        if (!cancelled) {
          setCatalog(value);
          setCatalogError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setCatalogError(caught instanceof Error ? caught.message : String(caught));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connected, catalog, service]);

  const report = useCallback(
    (message: string) => {
      session.stores.feedback.appendClient(` wizard: ${message}`, 'error');
    },
    [session],
  );

  /** A panel row's / menu leaf's `code`. Executed by PParse, server-side. */
  const exec = useCallback(
    (code: string) => {
      void service
        .exec(code)
        .catch((caught: unknown) =>
          report(caught instanceof Error ? caught.message : String(caught)),
        )
        .finally(() => {
          // `code` can do anything at all — the bridge classifies it `resync`.
          session.objectsSource.invalidate();
          session.poller.kick();
          kick();
        });
    },
    [service, report, session, kick],
  );

  const menu = useCallback(
    async (tag: string) => {
      const result = await service.menu(tag);
      if (result.error) throw new Error(result.error);
      return result.items;
    },
    [service],
  );

  const sendEvent = useCallback(
    (kind: WizardEventKind, payload: WizardEventPayload) => {
      void service
        .event(kind, payload)
        .then((result) => {
          if (!result.dispatched && result.reason) {
            report(`${kind} not dispatched: ${result.reason}`);
          }
        })
        .catch((caught: unknown) =>
          report(caught instanceof Error ? caught.message : String(caught)),
        )
        .finally(() => {
          session.objectsSource.invalidate();
          session.poller.kick();
          kick();
        });
    },
    [service, report, session, kick],
  );

  const run = useCallback(
    (commandLine: string) => {
      void session.run(commandLine).finally(kick);
    },
    [session, kick],
  );

  const dismiss = useCallback(() => {
    void service
      .dismiss()
      .catch((caught: unknown) => report(caught instanceof Error ? caught.message : String(caught)))
      .finally(kick);
  }, [service, report, kick]);

  return (
    <div className="wizards">
      <WizardLauncher
        catalog={catalog}
        error={catalogError ?? error}
        onRun={run}
        onDismiss={dismiss}
        active={snapshot.depth > 0}
      />

      <WizardPanel snapshot={snapshot} onExec={exec} onMenu={menu} />

      {snapshot.depth > 0 && (
        <>
          <WizardKeyCapture
            eventMask={snapshot.eventMask}
            onKey={(k, mod) => sendEvent('key', { k, mod })}
          />
          <WizardEventBridge eventMask={snapshot.eventMask} onSend={sendEvent} />
        </>
      )}

      <WizardPrompt lines={snapshot.prompt} mode={snapshot.promptMode} />
    </div>
  );
}

/**
 * The pick/select seam, made visible.
 *
 * In the desktop build these events originate in C++ mouse handling:
 * `SceneMouse.cpp:427,468` (atom pick), `:543` (bond pick), `:135,357`
 * (click-select), `Executive.cpp:7548` (box select), `Seeker.cpp:150,231`
 * (sequence viewer). In the web client the browser raycasts and WP-10 tells the
 * bridge which atom was hit; the bridge then reproduces the editor work
 * (`cmd.edit`) and calls `do_pick_state` + `do_pick`.
 *
 * WP-10's viewport pick does not route here yet, so rather than pretend picking
 * works, this exposes the same bridge call with a typed selection expression.
 * It is the identical code path — `wizards.event('pick', {selection})` — and it
 * disappears the moment the viewport wires itself in.
 */
function WizardEventBridge({
  eventMask,
  onSend,
}: {
  eventMask: number;
  onSend(kind: WizardEventKind, payload: WizardEventPayload): void;
}) {
  const [text, setText] = useState('');
  const wantsPick = (eventMask & WIZARD_EVENT_BITS.pick) !== 0;
  const wantsSelect = (eventMask & WIZARD_EVENT_BITS.select) !== 0;
  if (!wantsPick && !wantsSelect) return null;

  return (
    <div className="wizevents" data-testid="wizard-events">
      <div className="wizevents__head" title="layer1/SceneMouse.cpp:427,468 — WP-10 owns the ray pick">
        pick seam (until the viewport routes picks here)
      </div>
      <input
        className="wizevents__input"
        placeholder="selection, e.g. ala and name CA"
        value={text}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && text.trim() && wantsPick) {
            onSend('pick', { selection: text.trim() });
          }
        }}
      />
      <div className="wizevents__buttons">
        <button
          type="button"
          disabled={!wantsPick || text.trim() === ''}
          onClick={() => onSend('pick', { selection: text.trim() })}
        >
          do_pick
        </button>
        <button
          type="button"
          disabled={!wantsPick || text.trim() === ''}
          onClick={() => onSend('pick', { selection: text.trim(), bond: true })}
        >
          do_pick(bond)
        </button>
        <button
          type="button"
          disabled={!wantsSelect || text.trim() === ''}
          onClick={() => onSend('select', { name: text.trim() })}
        >
          do_select
        </button>
      </div>
    </div>
  );
}
