export const CROSS_WORKSPACE_REFRESH_TARGETS = ["workspace", "tracker", "dashboard", "activity"] as const;

export async function runCrossWorkspaceRefreshers(
  refreshers: Record<(typeof CROSS_WORKSPACE_REFRESH_TARGETS)[number], () => Promise<unknown>>,
): Promise<void> {
  await Promise.all(CROSS_WORKSPACE_REFRESH_TARGETS.map(target => refreshers[target]()));
}
