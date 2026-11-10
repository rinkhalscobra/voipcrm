import type { Permission, UserContext } from "../types";
export function hasPermission(
  context: UserContext,
  permission: Permission,
): boolean {
  return (
    !context.suspended &&
    (context.platform_role === "super_admin" ||
      context.permissions.includes(permission))
  );
}
export function homeFor(context: UserContext) {
  return context.platform_role
    ? "/admin"
    : context.membership?.role === "client"
      ? "/client"
      : context.membership?.role === "company_admin"
        ? "/company"
        : context.membership?.role === "team_leader"
          ? "/team-leader"
          : context.membership?.role === "manager"
            ? "/manager"
            : "/agent";
}
export function canReadSnapshot(
  context: UserContext,
  row: {
    company_id: string | null;
    user_id: string | null;
    manager_id: string | null;
    team_leader_id: string | null;
  },
) {
  if (context.suspended) return false;
  if (context.platform_role) return hasPermission(context, "calls.read");
  const m = context.membership;
  if (!m?.active || m.company_id !== row.company_id) return false;
  return (
    m.role === "company_admin" ||
    row.user_id === context.id ||
    (m.role === "manager" && row.manager_id === context.id) ||
    (m.role === "team_leader" && row.team_leader_id === context.id)
  );
}
