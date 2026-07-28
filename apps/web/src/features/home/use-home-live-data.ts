// P1-2: Shared home live data — one React Query key per resource for Hero + FeaturesBento.
// Aligning limits/keys ensures a single network request even when both sections mount.

import { useAgentActivity } from "../activity/use-agent-activity.ts";
import { useAlerts } from "../alerts/use-alerts.ts";
import { useDeskStatus } from "../desk/use-desk.ts";

/** Shared home feed size — Hero slices client-side; FeaturesBento uses the head. */
export const HOME_ALERTS_LIMIT = 5;

/**
 * Prefetch / subscribe to the three home live endpoints with identical query keys.
 * Call once from HomePage so Hero + FeaturesBento share cache without double-fetch.
 */
export function useHomeLiveData() {
  const alerts = useAlerts(HOME_ALERTS_LIMIT);
  const activity = useAgentActivity();
  const desk = useDeskStatus();

  return {
    alerts: alerts.alerts,
    alertsLoading: alerts.isLoading,
    alertsError: alerts.error,
    activity: activity.data,
    activityLoading: activity.isLoading,
    activityError: activity.error,
    desk: desk.data,
    deskLoading: desk.isLoading,
    deskError: desk.error,
    isLoading: alerts.isLoading || activity.isLoading || desk.isLoading,
  };
}
