-- ─── User RBAC fields ──────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "User" ADD COLUMN "permissionsGrant" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "permissionsRevoke" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "invitedBy" TEXT;
ALTER TABLE "User" ADD COLUMN "invitedAt" TIMESTAMP(3);

CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_status_idx" ON "User"("status");

-- ─── Role table ────────────────────────────────────────────────────────────
CREATE TABLE "Role" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "Role_rank_idx" ON "Role"("rank");

-- ─── Seed default roles ────────────────────────────────────────────────────
INSERT INTO "Role" ("key", "name", "description", "isSystem", "rank", "permissions", "updatedAt") VALUES
  ('USER',        'Member',       'Standard authenticated user. Manages own alerts, watchlists, and notifications.', true, 10, ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('ANALYST',     'Analyst',      'Read-only access to all alerts, watchlists, and logs across the system.',          true, 20, ARRAY['alerts.view_all','watchlists.view_all','logs.view_all','crawler.view'], CURRENT_TIMESTAMP),
  ('MODERATOR',   'Moderator',    'Can manage other users (suspend/activate) and oversee shared data.',                true, 30, ARRAY['users.read','users.suspend','alerts.view_all','alerts.manage_all','watchlists.view_all','watchlists.manage_all','logs.view_all','crawler.view','notifications.manage'], CURRENT_TIMESTAMP),
  ('ADMIN',       'Administrator','Full operational control including settings, database, and crawler.',                true, 40, ARRAY['users.read','users.write','users.suspend','users.invite','roles.read','alerts.view_all','alerts.manage_all','watchlists.view_all','watchlists.manage_all','logs.view_all','crawler.view','crawler.control','settings.read','settings.write','database.access','notifications.manage','audit.view'], CURRENT_TIMESTAMP),
  ('SUPER_ADMIN', 'Super Admin',  'Unrestricted access. Can edit roles and assign permissions.',                       true, 100, ARRAY['*'], CURRENT_TIMESTAMP);

-- Promote the legacy ADMIN to SUPER_ADMIN so role/permission management is reachable
UPDATE "User" SET "role" = 'SUPER_ADMIN' WHERE LOWER("email") = 'bhattaraiashok101@gmail.com';
