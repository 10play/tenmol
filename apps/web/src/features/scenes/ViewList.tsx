/**
 * Named camera views — the panel the inventory row asks for (`00:336`).
 *
 * It sits under the scene bin because that is where the user looks for "saved
 * camera", but it is a different feature with different guarantees: no
 * thumbnail, no colours, no reps, no order (the listing is sorted, always), and
 * pure Python state that only exists inside a session.
 *
 * Every button sends the FULL name, never the user's typed text — the key is a
 * `Shortcut` prefix and `view al` stops meaning `alpha` the moment `album`
 * exists (`viewActions.ts`).
 */

import { useState } from 'react';
import { Button, TextInput } from '../../ui';
import { useViews } from './useViews';
import { viewActions, viewNameProblem } from './viewActions';

/** Panel listing named camera views, with a field to store the current one. */
export function ViewList() {
  const { names, error, run, refresh } = useViews();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const store = () => {
    const reason = viewNameProblem(draft);
    if (reason !== null) {
      setProblem(reason);
      return;
    }
    setProblem(null);
    setDraft('');
    void run(viewActions.store(draft));
  };

  return (
    <div className="vwlist">
      <div className="vwlist__head">
        <span className="vwlist__title">Views</span>
        <span className="scpanel__count">{names.length}</span>
        <span className="scpanel__spacer" />
        <TextInput
          className={`vwlist__name${problem ? ' is-invalid' : ''}`}
          value={draft}
          placeholder="name"
          spellCheck={false}
          aria-label="view name"
          aria-invalid={problem !== null}
          onChange={(event) => {
            setDraft(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') store();
          }}
        />
        <Button
          className="scpanel__btn"
          title='cmd.view(name, "store") — overwrites, because "update" is dead code'
          onClick={store}
        >
          store
        </Button>
        <Button
          className="scpanel__btn"
          title='cmd.view("*", "clear")'
          onClick={() => void run(viewActions.clearAll())}
        >
          clear all
        </Button>
        <Button
          className="scpanel__btn"
          title="re-read the view list"
          onClick={() => void refresh()}
        >
          ↻
        </Button>
      </div>

      {problem !== null && (
        <p className="vwlist__err" role="alert">
          {problem}
        </p>
      )}
      {error !== null && (
        <p className="vwlist__err" role="alert">
          view list unavailable: {error}
        </p>
      )}

      <div className="vwlist__rows" role="list">
        {names.length === 0 && (
          <span className="scbar__empty modern:text-pm-text-dim">no views</span>
        )}
        {names.map((name) => (
          <span className="vwrow" key={name} role="listitem">
            <Button
              className="vwrow__name"
              title={`cmd.view("${name}", "recall") — ctrl-click for no animation`}
              onClick={(event) =>
                void run(
                  event.ctrlKey || event.metaKey
                    ? viewActions.recallInstant(name)
                    : viewActions.recall(name),
                )
              }
            >
              {name}
            </Button>
            <Button
              className="vwrow__del"
              aria-label={`delete view ${name}`}
              title={`cmd.view("${name}", "clear")`}
              onClick={() => void run(viewActions.clear(name))}
            >
              ×
            </Button>
          </span>
        ))}
      </div>
    </div>
  );
}
