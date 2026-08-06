/**
 * `cn` — the one class-name joiner every primitive uses.
 *
 * `clsx` flattens the conditional/array/object forms; `twMerge` de-duplicates
 * CONFLICTING Tailwind utilities (`p-2 p-4` -> `p-4`) so the shadcn variants can
 * layer utilities without last-wins surprises. Crucially, `twMerge` leaves
 * classes it does not recognise as Tailwind utilities untouched — so the classic
 * BEM contract classes (`quickbutton`, `objrow__op`, `cmdline__input`, …) always
 * survive verbatim, which is exactly what the ~140 class-name-pinned tests read.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
