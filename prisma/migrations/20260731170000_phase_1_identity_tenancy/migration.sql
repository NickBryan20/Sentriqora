CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "mfa_method_type" AS ENUM ('TOTP');
CREATE TYPE "invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organizations_name_check" CHECK (char_length(btrim("name")) BETWEEN 2 AND 120),
    CONSTRAINT "organizations_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "normalized_email" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_check" CHECK (char_length("normalized_email") BETWEEN 3 AND 254 AND "normalized_email" = lower("normalized_email")),
    CONSTRAINT "users_display_name_check" CHECK (char_length(btrim("display_name")) BETWEEN 2 AND 120)
);

CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");
CREATE INDEX "users_status_idx" ON "users"("status");

CREATE TABLE "credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credentials_failed_attempts_check" CHECK ("failed_attempts" >= 0),
    CONSTRAINT "credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "credentials_user_id_key" ON "credentials"("user_id");

CREATE TABLE "mfa_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "mfa_method_type" NOT NULL DEFAULT 'TOTP',
    "label" VARCHAR(80) NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "encryption_iv" VARCHAR(32) NOT NULL,
    "encryption_auth_tag" VARCHAR(32) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "last_used_counter" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_methods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mfa_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mfa_methods_user_type_key" ON "mfa_methods"("user_id", "type");
CREATE INDEX "mfa_methods_user_verified_idx" ON "mfa_methods"("user_id", "verified_at");

CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "recovery_codes_user_hash_key" ON "recovery_codes"("user_id", "code_hash");
CREATE INDEX "recovery_codes_user_unused_idx" ON "recovery_codes"("user_id", "used_at");

CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "memberships_org_user_key" ON "memberships"("organization_id", "user_id");
CREATE UNIQUE INDEX "memberships_id_org_key" ON "memberships"("id", "organization_id");
CREATE INDEX "memberships_user_status_idx" ON "memberships"("user_id", "status");
CREATE INDEX "memberships_org_status_idx" ON "memberships"("organization_id", "status");

CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(240) NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "roles_key_check" CHECK ("key" ~ '^[a-z][a-z0-9._-]{1,63}$'),
    CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "roles_org_key_key" ON "roles"("organization_id", "key");
CREATE UNIQUE INDEX "roles_id_org_key" ON "roles"("id", "organization_id");
CREATE INDEX "roles_org_system_idx" ON "roles"("organization_id", "is_system");

CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(100) NOT NULL,
    "description" VARCHAR(240) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "permissions_key_check" CHECK ("key" ~ '^[a-z][a-z0-9.-]{2,99}$')
);

CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

CREATE TABLE "role_permissions" (
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("organization_id", "role_id", "permission_id"),
    CONSTRAINT "role_permissions_role_fkey" FOREIGN KEY ("role_id", "organization_id") REFERENCES "roles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "role_permissions_org_permission_idx" ON "role_permissions"("organization_id", "permission_id");

CREATE TABLE "membership_roles" (
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("organization_id", "membership_id", "role_id"),
    CONSTRAINT "membership_roles_membership_fkey" FOREIGN KEY ("membership_id", "organization_id") REFERENCES "memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "membership_roles_role_fkey" FOREIGN KEY ("role_id", "organization_id") REFERENCES "roles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "membership_roles_org_role_idx" ON "membership_roles"("organization_id", "role_id");

CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "normalized_email" VARCHAR(254) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'PENDING',
    "invited_by_user_id" UUID NOT NULL,
    "accepted_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitations_expiry_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invitations_role_fkey" FOREIGN KEY ("role_id", "organization_id") REFERENCES "roles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE INDEX "invitations_org_status_expiry_idx" ON "invitations"("organization_id", "status", "expires_at");
CREATE INDEX "invitations_email_status_idx" ON "invitations"("normalized_email", "status");

CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_name" VARCHAR(120) NOT NULL,
    "user_agent_hash" CHAR(64) NOT NULL,
    "ip_address" INET NOT NULL,
    "mfa_verified_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_expiry_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sessions_id_org_key" ON "sessions"("id", "organization_id");
CREATE INDEX "sessions_org_user_active_idx" ON "sessions"("organization_id", "user_id", "revoked_at");
CREATE INDEX "sessions_expiry_idx" ON "sessions"("expires_at");

CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "parent_token_id" UUID,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refresh_tokens_expiry_check" CHECK ("expires_at" > "issued_at"),
    CONSTRAINT "refresh_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "refresh_tokens_session_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "refresh_tokens_parent_token_id_fkey" FOREIGN KEY ("parent_token_id") REFERENCES "refresh_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE UNIQUE INDEX "refresh_tokens_parent_token_id_key" ON "refresh_tokens"("parent_token_id");
CREATE INDEX "refresh_tokens_org_session_expiry_idx" ON "refresh_tokens"("organization_id", "session_id", "expires_at");
CREATE INDEX "refresh_tokens_family_revoked_idx" ON "refresh_tokens"("family_id", "revoked_at");

CREATE TABLE "mfa_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mfa_challenges_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5),
    CONSTRAINT "mfa_challenges_expiry_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "mfa_challenges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "mfa_challenges_org_user_expiry_idx" ON "mfa_challenges"("organization_id", "user_id", "expires_at");

CREATE TABLE "event_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(120) NOT NULL,
    "outcome" VARCHAR(32) NOT NULL,
    "correlation_id" VARCHAR(80) NOT NULL,
    "ip_hash" CHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "event_records_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "event_records_org_time_idx" ON "event_records"("organization_id", "occurred_at");
CREATE INDEX "event_records_org_action_time_idx" ON "event_records"("organization_id", "action", "occurred_at");

ALTER TABLE "outbox_events"
    ADD CONSTRAINT "outbox_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description") VALUES
    ('organization.read', 'Read the active organization'),
    ('organization.manage', 'Manage organization settings and create organizations'),
    ('member.read', 'Read organization memberships'),
    ('member.invite', 'Invite a member to the organization'),
    ('member.manage', 'Manage membership role assignments'),
    ('role.read', 'Read organization roles and permission catalog'),
    ('role.manage', 'Create roles and assign permissions'),
    ('session.read', 'Read the current user sessions'),
    ('session.revoke', 'Revoke the current user sessions'),
    ('mfa.manage', 'Manage the current user MFA methods');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegisflow_app') THEN
        CREATE ROLE aegisflow_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

GRANT aegisflow_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO aegisflow_app;
GRANT USAGE ON TYPE "user_status", "membership_status", "mfa_method_type", "invitation_status", "outbox_status" TO aegisflow_app;
GRANT SELECT, INSERT, UPDATE ON "organizations", "users", "credentials", "mfa_methods", "recovery_codes", "memberships", "roles", "invitations", "sessions", "refresh_tokens", "mfa_challenges" TO aegisflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "role_permissions", "membership_roles" TO aegisflow_app;
GRANT SELECT ON "permissions" TO aegisflow_app;
GRANT SELECT, INSERT ON "event_records" TO aegisflow_app;
GRANT SELECT, INSERT, UPDATE ON "outbox_events" TO aegisflow_app;

CREATE FUNCTION aegisflow_current_organization_id() RETURNS UUID
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.current_organization_id', true), '')::UUID
$$;

CREATE FUNCTION aegisflow_current_user_id() RETURNS UUID
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID
$$;

GRANT EXECUTE ON FUNCTION aegisflow_current_organization_id() TO aegisflow_app;
GRANT EXECUTE ON FUNCTION aegisflow_current_user_id() TO aegisflow_app;

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "organizations_select_policy" ON "organizations" FOR SELECT TO aegisflow_app
USING (
    "id" = aegisflow_current_organization_id()
    OR EXISTS (
        SELECT 1 FROM "memberships" AS membership
        WHERE membership."organization_id" = "organizations"."id"
          AND membership."user_id" = aegisflow_current_user_id()
          AND membership."status" = 'ACTIVE'
    )
);
CREATE POLICY "organizations_write_policy" ON "organizations" FOR ALL TO aegisflow_app
USING ("id" = aegisflow_current_organization_id())
WITH CHECK ("id" = aegisflow_current_organization_id());

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "memberships_select_policy" ON "memberships" FOR SELECT TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id() OR "user_id" = aegisflow_current_user_id());
CREATE POLICY "memberships_write_policy" ON "memberships" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "roles_tenant_policy" ON "roles" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "role_permissions_tenant_policy" ON "role_permissions" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "membership_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "membership_roles_tenant_policy" ON "membership_roles" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invitations_tenant_policy" ON "invitations" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "sessions_tenant_policy" ON "sessions" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY "refresh_tokens_tenant_policy" ON "refresh_tokens" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "mfa_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mfa_challenges" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mfa_challenges_tenant_policy" ON "mfa_challenges" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "event_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "event_records_tenant_policy" ON "event_records" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outbox_events_tenant_policy" ON "outbox_events" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

CREATE FUNCTION prevent_event_record_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'event_records are append-only' USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "event_records_append_only"
BEFORE UPDATE OR DELETE ON "event_records"
FOR EACH ROW EXECUTE FUNCTION prevent_event_record_mutation();
