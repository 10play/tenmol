/**
 * Topic `wizard` — the generic wizard panel.  OWNER: WP-16.
 *
 * Polled from `cmd.get_wizard()` (0.9 us median, plan §1.5). The client is a
 * GENERIC renderer: it never interprets `code`, it just draws the rows the
 * wizard declares and sends the tag back.
 *
 * The wizard EVENT MASK (`layer1/Wizard.cpp:49-58`) is NOT a transport
 * (plan §1.5, measured): draw-pumped, misses delete/select/ungroup entirely,
 * costs 38,313 us per pump after a recolour-all, and there is exactly ONE
 * user-owned wizard stack — a bridge "spy" wizard received zero events after
 * `cmd.wizard('measurement')`.
 */

/** One row of `Wizard.get_panel()`: `[code, text, tag]`. */
export interface WizardPanelRow {
  /** 1 = title, 2 = button, 3 = popup/menu. Never interpreted client-side. */
  code: number;
  text: string;
  /** Command tag echoed back to the wizard. */
  tag: string;
}

export interface WizardPayload {
  /** Wizard class name, or null when no wizard is active. */
  name: string | null;
  panel: WizardPanelRow[];
  /** `Wizard.get_prompt()` lines rendered as the viewport overlay. */
  prompt: string[];
  /** Depth of the wizard stack; > 1 means a nested wizard. */
  depth: number;
}
