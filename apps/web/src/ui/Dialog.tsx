/**
 * Dialog — a real shadcn/Radix modal, offered as a primitive for new panels.
 *
 * NOT a drop-in for the app's existing bespoke modals (`features/files/Modal`,
 * `features/dialogs/DialogWindow`), whose DOM the tests pin — those stay and get
 * restyled by CSS. This is here for new surfaces (e.g. the About/Theme dialog).
 */

import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

/** Root of a Radix modal dialog; wraps trigger, content and close. */
export const Dialog = RadixDialog.Root;
/** The control that opens the {@link Dialog}. */
export const DialogTrigger = RadixDialog.Trigger;
/** A control that closes the {@link Dialog}. */
export const DialogClose = RadixDialog.Close;

/** The centred, portalled dialog surface (overlay + panel + a built-in close). */
export function DialogContent({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof RadixDialog.Content>) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-[80] bg-[color-mix(in_srgb,#1e1b4b_38%,transparent)] data-[state=open]:animate-in"
      />
      <RadixDialog.Content
        data-slot="dialog-content"
        className={cn(
          'fixed left-1/2 top-1/2 z-[80] w-full max-w-md -translate-x-1/2 -translate-y-1/2',
          'rounded-[var(--sh-r-panel)] border border-line-strong bg-[var(--sh-panel-frost)] backdrop-blur-2xl backdrop-saturate-150',
          'p-5 font-sans text-[12px] text-pm-text shadow-[var(--sh-pop)]',
          className,
        )}
        {...props}
      >
        {children}
        <RadixDialog.Close
          aria-label="Close"
          className="absolute right-3 top-3 text-pm-text-dim outline-none hover:text-pm-text-bright"
        >
          <X className="h-4 w-4" />
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

/** The dialog's accessible title (labels the modal for screen readers). */
export function DialogTitle({
  className,
  ...props
}: ComponentPropsWithRef<typeof RadixDialog.Title>) {
  return (
    <RadixDialog.Title
      data-slot="dialog-title"
      className={cn('mb-1 text-[13px] font-semibold text-pm-text-bright', className)}
      {...props}
    />
  );
}

/** The dialog's supporting description text, announced after the title. */
export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithRef<typeof RadixDialog.Description>) {
  return (
    <RadixDialog.Description
      data-slot="dialog-description"
      className={cn('mb-3 text-pm-text-dim', className)}
      {...props}
    />
  );
}
