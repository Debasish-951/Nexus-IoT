/**
 * Who may list, download and delete an uploaded file (audit 23 Nov 2026, M-2).
 *
 * Uploads used to be open to everyone holding the Visualization module: a user
 * restricted to one project could list and download every project's images and
 * 3D models, and anyone with Visualization delete could delete anyone's file.
 *
 *   list      unrestricted users: every file. Project-restricted users: their own
 *             files and files of their projects.
 *   download  as list, plus files with no project. Those are shared across the
 *             installation (every file uploaded before files had a project), are
 *             referenced by id from dashboards and twins that restricted users
 *             open, and their ids are random UUIDs that are never listed to them.
 *   delete    the uploader, or an administrator (manage_users) who could list it.
 *
 * Pure, so it can be tested without a database.
 */
export interface UploadViewer {
  userId: string | null;
  restricted: boolean;
  allowedProjects: ReadonlySet<string>;
  /** Holds `manage_users` (Admin, Company Admin, Super Admin). */
  admin: boolean;
}

export interface UploadRef {
  uploadedBy: string | null;
  projectId: string | null;
}

function own(v: UploadViewer, row: UploadRef): boolean {
  return !!v.userId && row.uploadedBy === v.userId;
}

export function canListUpload(v: UploadViewer, row: UploadRef): boolean {
  if (!v.restricted || own(v, row)) return true;
  return !!row.projectId && v.allowedProjects.has(row.projectId);
}

export function canDownloadUpload(v: UploadViewer, row: UploadRef): boolean {
  return canListUpload(v, row) || row.projectId === null;
}

export function canDeleteUpload(v: UploadViewer, row: UploadRef): boolean {
  if (own(v, row)) return true;
  return v.admin && canListUpload(v, row);
}

/**
 * The project a new upload belongs to. `requested` is the multipart `projectId`
 * field (the project open in the app). Returns an error message when the caller
 * may not use that project.
 */
export function chooseUploadProject(
  v: UploadViewer,
  requested: string | null,
  isProject: (id: string) => boolean,
): { projectId: string | null } | { error: string } {
  if (requested) {
    if (!isProject(requested)) return { error: "That project does not exist." };
    if (v.restricted && !v.allowedProjects.has(requested)) return { error: "You do not have access to that project." };
    return { projectId: requested };
  }
  // A restricted user with exactly one project: that project. Otherwise the file
  // has no project; a restricted uploader still sees it as their own.
  if (v.restricted && v.allowedProjects.size === 1) return { projectId: [...v.allowedProjects][0]! };
  return { projectId: null };
}
