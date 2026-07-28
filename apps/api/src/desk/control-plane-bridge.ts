// Late-bound desk control plane so premium routes (US3) can share the
// singleton wired during US1 desk setup.

import type { DeskControlPlane } from "./control-plane.ts";

let registered: DeskControlPlane | undefined;

export function registerDeskControlPlane(plane: DeskControlPlane): void {
  registered = plane;
}

export function getDeskControlPlane(): DeskControlPlane | undefined {
  return registered;
}
