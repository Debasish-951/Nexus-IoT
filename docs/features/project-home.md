# Project Home

Home lists the projects a user may open. A project is a root-level asset. Each card opens that project's Assets or Visualization, and a button appears only if the user has that module.

## Who sees which projects

| Role | Projects |
|---|---|
| Project Manager | All |
| Team Lead, Developer | Only those ticked under Users > Project Access. None ticked means none |
| Other roles | Follow the user's Project Access setting |

The server applies this in `resolveAccess` (`lib/rbac.ts`) and enforces it in `lib/project-access.ts`. Developer has the same rights as Engineer.

The earlier Overview and Classic Home views are no longer reachable. `pages/HomeOverview.tsx` and `pages/Dashboard.tsx` are kept until it is confirmed nobody needs them.

## Visualization and projects

A top-level Visualization dashboard can belong to one project, and nested dashboards follow it. Right-click it and select **Assign to Project**. Dashboards created inside a project are assigned to it automatically.

Unassigned dashboards show in every project. Owner and sharing rules still decide who can open a dashboard, so assigning one to a project does not give that project's users access.

## Deployment

Run `pnpm --filter @workspace/db run push`, which adds `viz_nodes.project_id`, and restart the API.

The `home_boards` table from the earlier Published Home feature is no longer used. It is kept for now, so its data is not lost. To remove it, delete `lib/db/src/schema/home_boards.ts` and its export, then run the push.
