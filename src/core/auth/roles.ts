/** The two kinds of admin account. */
export const ADMIN_ROLES = ['MODERATOR', 'ADMIN'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLE_LABEL: Record<AdminRole, string> = {
  MODERATOR: 'Moderator',
  ADMIN: 'Admin',
};

/** Moderators can edit everything and manage admins; admins only update semester status. */
export const isModerator = (role: string | undefined | null) => role === 'MODERATOR';

/** Holiday category an ADMIN may add/remove from the Semester Status board. */
export const ADMIN_HOLIDAY_CATEGORY = 'UNOFFICIAL_BREAK';

