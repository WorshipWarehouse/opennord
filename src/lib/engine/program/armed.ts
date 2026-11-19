import { useSyncExternalStore } from 'react';

// Session-wide intent survives the keyed program inspector and scene changes.
// Only the selected program owns audio; navigating away still disposes its voices.
let armed = true;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setProgramArmed(next: boolean): void {
  armed = next;
  for (const listener of listeners) listener();
}
export function useProgramArmed(): boolean {
  return useSyncExternalStore(subscribe, () => armed, () => false);
}
