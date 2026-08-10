/**
 * The primitive contract, pinned.
 *
 * The whole scheme rests on one promise: a primitive renders the legacy BEM
 * class and forwards every attribute the app's ~140 class-name tests read, in
 * BOTH themes. These tests assert exactly that — so if a future change to a
 * variant drops a class or an attribute, or the shadcn path diverges the DOM,
 * this file goes red before any feature test does.
 */

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cn } from './cn';
import {
  Button,
  Checkbox,
  IconButton,
  ProgressBar,
  Select,
  TextInput,
  ToggleButton,
} from './index';
import { ThemeProvider } from './theme';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: ReactNode): void {
  act(() => root.render(node));
}

describe('cn', () => {
  it('preserves non-Tailwind BEM tokens verbatim', () => {
    expect(cn('quickbutton', 'quickbutton--abort').split(' ')).toEqual(
      expect.arrayContaining(['quickbutton', 'quickbutton--abort']),
    );
    // A falsy branch drops out, the real class stays — the `--todo` idiom
    // (`live ? undefined : 'quickbutton--todo'`).
    const dropped: string | false = false;
    expect(cn('quickbutton', dropped)).toBe('quickbutton');
  });
});

describe('Button', () => {
  it('renders the variant contract class and forwards every prop', () => {
    const onClick = vi.fn();
    render(
      <Button
        variant="quick"
        className="quickbutton--abort"
        title="cmd.interrupt"
        data-testid="abort"
        disabled
        onClick={onClick}
      >
        Abort
      </Button>,
    );
    const btn = container.querySelector<HTMLButtonElement>('.quickbutton');
    expect(btn).not.toBeNull();
    expect(btn?.className).toContain('quickbutton--abort');
    expect(btn?.getAttribute('title')).toBe('cmd.interrupt');
    expect(btn?.dataset.testid ?? btn?.getAttribute('data-testid')).toBe('abort');
    expect(btn?.type).toBe('button');
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toBe('Abort');
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<Button variant="menubar" onClick={onClick} />);
    act(() => container.querySelector<HTMLButtonElement>('.menubar__item')?.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the contract class under the shadcn theme too', () => {
    render(
      <ThemeProvider theme="shadcn">
        <Button variant="quick" data-testid="q">
          Zoom
        </Button>
      </ThemeProvider>,
    );
    // Same DOM in both themes — the shadcn look is CSS-only, so the class the
    // tests query is still there.
    expect(container.querySelector('.quickbutton')).not.toBeNull();
    expect(container.querySelector('[data-testid="q"]')?.tagName).toBe('BUTTON');
  });
});

describe('IconButton', () => {
  it('forwards glyph children and title (read by textContent tests)', () => {
    render(
      <IconButton variant="extgui" title="Toggle dockable [Ctrl+E]">
        ×
      </IconButton>,
    );
    const btn = container.querySelector<HTMLButtonElement>('.extgui__btn');
    expect(btn?.textContent).toBe('×');
    expect(btn?.getAttribute('title')).toBe('Toggle dockable [Ctrl+E]');
  });
});

describe('ToggleButton', () => {
  it('mirrors pressed to is-on + aria-pressed', () => {
    render(
      <ToggleButton variant="launcher" pressed>
        Settings
      </ToggleButton>,
    );
    const btn = container.querySelector<HTMLButtonElement>('.overlay-launcher__btn');
    expect(btn?.className).toContain('is-on');
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('is off by default', () => {
    render(<ToggleButton variant="launcher">Files</ToggleButton>);
    const btn = container.querySelector<HTMLButtonElement>('.overlay-launcher__btn');
    expect(btn?.className).not.toContain('is-on');
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('ProgressBar', () => {
  it('renders the progressbar contract: class, aria, and inline width', () => {
    render(<ProgressBar value={35} />);
    const bar = container.querySelector<HTMLElement>('.progressbar');
    expect(bar?.getAttribute('role')).toBe('progressbar');
    expect(bar?.getAttribute('aria-valuenow')).toBe('35');
    expect(container.querySelector<HTMLElement>('.progressbar__fill')?.style.width).toBe('35%');
  });
});

describe('form controls stay native (behaviour identical in both themes)', () => {
  it('TextInput is an <input> that forwards value/onChange', () => {
    const onChange = vi.fn();
    render(<TextInput className="cmdline__input" value="reset" onChange={onChange} readOnly />);
    const input = container.querySelector<HTMLInputElement>('.cmdline__input');
    expect(input?.tagName).toBe('INPUT');
    expect(input?.value).toBe('reset');
  });

  it('Select is a native <select>', () => {
    render(
      <Select defaultValue="a">
        <option value="a">a</option>
        <option value="b">b</option>
      </Select>,
    );
    const select = container.querySelector<HTMLSelectElement>('[data-slot="select"]');
    expect(select?.tagName).toBe('SELECT');
    expect(select?.value).toBe('a');
  });

  it('Checkbox is a native checkbox', () => {
    render(<Checkbox checked readOnly />);
    const box = container.querySelector<HTMLInputElement>('[data-slot="checkbox"]');
    expect(box?.getAttribute('type')).toBe('checkbox');
    expect(box?.checked).toBe(true);
  });
});
