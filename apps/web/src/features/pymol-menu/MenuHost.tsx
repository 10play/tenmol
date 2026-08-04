/**
 * The `pymol-menu` slot's component: the pop-up, plus the leaf hooks it needs.
 *
 * WHY A HOST AND NOT JUST `PopupMenu`. Registering a leaf hook has to happen
 * from something that is ALWAYS MOUNTED, and this slot is the only such place
 * either of these two directories owns — `slotsForRegion('service')` is rendered
 * unconditionally by `AppShell`, while `volume` is an OVERLAY slot that does not
 * exist until a window is already open. Registering from the panel would bind
 * the hook that OPENS the panel only while the panel was open; three features
 * have shipped dead handlers exactly that way.
 *
 * `PopupMenu` itself stays a pure renderer, so the pop-up tests keep driving it
 * directly with no bridge in the way.
 */

import { useEffect } from 'react';
import { useSession } from '../../app';
import { installVolumeMenuBridge } from '../volume/menuBridge';
import { PopupMenu } from './PopupMenu';

export function MenuHost() {
  const session = useSession();
  useEffect(() => installVolumeMenuBridge(session), [session]);
  return <PopupMenu />;
}
