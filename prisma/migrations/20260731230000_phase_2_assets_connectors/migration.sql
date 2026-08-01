CREATE TYPE "asset_type" AS ENUM ('APPLICATION', 'SERVER', 'API', 'DATABASE', 'REPOSITORY', 'OTHER');
CREATE TYPE "asset_criticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "asset_status" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "asset_dependency_kind" AS ENUM ('DEPENDS_ON', 'HOSTED_ON', 'CONNECTS_TO', 'STORES_DATA_IN', 'USES');
CREATE TYPE "connector_type" AS ENUM ('WEBHOOK', 'REST_API', 'JSON_IMPORT', 'CSV_IMPORT', 'GITHUB', 'SIMULATOR');
CREATE TYPE "connector_status" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "idempotency_status" AS ENUM ('PROCESSING', 'COMPLETED');

CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "owner_membership_id" UUID,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "type" "asset_type" NOT NULL,
    "criticality" "asset_criticality" NOT NULL,
    "status" "asset_status" NOT NULL DEFAULT 'ACTIVE',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assets_version_check" CHECK ("version" > 0),
    CONSTRAINT "assets_archive_state_check" CHECK (
        ("status" = 'ARCHIVED' AND "archived_at" IS NOT NULL)
        OR ("status" = 'ACTIVE' AND "archived_at" IS NULL)
    ),
    CONSTRAINT "assets_tags_check" CHECK (cardinality("tags") <= 20)
);

CREATE TABLE "asset_dependencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_asset_id" UUID NOT NULL,
    "target_asset_id" UUID NOT NULL,
    "kind" "asset_dependency_kind" NOT NULL,
    "description" VARCHAR(240) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asset_dependencies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_dependencies_no_self_check" CHECK ("source_asset_id" <> "target_asset_id")
);

CREATE TABLE "connectors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "type" "connector_type" NOT NULL,
    "status" "connector_status" NOT NULL DEFAULT 'ACTIVE',
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connectors_version_check" CHECK ("version" > 0),
    CONSTRAINT "connectors_configuration_check" CHECK (jsonb_typeof("configuration") = 'object')
);

CREATE TABLE "webhook_secrets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "secret_hash" CHAR(64) NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "encryption_iv" VARCHAR(32) NOT NULL,
    "encryption_auth_tag" VARCHAR(32) NOT NULL,
    "prefix" VARCHAR(12) NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_secrets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_secrets_expiry_check" CHECK ("expires_at" IS NULL OR "expires_at" > "valid_from")
);

CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "api_keys_scopes_check" CHECK (
        cardinality("scopes") BETWEEN 1 AND 2
        AND "scopes" <@ ARRAY['connector.ingest', 'connector.health']::TEXT[]
    ),
    CONSTRAINT "api_keys_expiry_check" CHECK ("expires_at" IS NULL OR "expires_at" > "created_at")
);

CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "scope" VARCHAR(120) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'PROCESSING',
    "response_status" INTEGER,
    "response_payload" JSONB,
    "resource_type" VARCHAR(80),
    "resource_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "idempotency_records_completion_check" CHECK (
        ("status" = 'PROCESSING' AND "completed_at" IS NULL AND "response_status" IS NULL)
        OR ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL AND "response_status" IS NOT NULL)
    ),
    CONSTRAINT "idempotency_records_response_status_check" CHECK (
        "response_status" IS NULL OR "response_status" BETWEEN 200 AND 599
    ),
    CONSTRAINT "idempotency_records_expiry_check" CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "assets_org_key_key" ON "assets"("organization_id", "key");
CREATE UNIQUE INDEX "assets_id_org_key" ON "assets"("id", "organization_id");
CREATE INDEX "assets_org_status_criticality_idx" ON "assets"("organization_id", "status", "criticality");
CREATE INDEX "assets_org_owner_idx" ON "assets"("organization_id", "owner_membership_id");

CREATE UNIQUE INDEX "asset_dependencies_edge_key" ON "asset_dependencies"("organization_id", "source_asset_id", "target_asset_id", "kind");
CREATE UNIQUE INDEX "asset_dependencies_id_org_key" ON "asset_dependencies"("id", "organization_id");
CREATE INDEX "asset_dependencies_org_target_idx" ON "asset_dependencies"("organization_id", "target_asset_id");

CREATE UNIQUE INDEX "connectors_org_key_key" ON "connectors"("organization_id", "key");
CREATE UNIQUE INDEX "connectors_id_org_key" ON "connectors"("id", "organization_id");
CREATE INDEX "connectors_org_status_type_idx" ON "connectors"("organization_id", "status", "type");

CREATE UNIQUE INDEX "webhook_secrets_secret_hash_key" ON "webhook_secrets"("secret_hash");
CREATE UNIQUE INDEX "webhook_secrets_id_org_key" ON "webhook_secrets"("id", "organization_id");
CREATE INDEX "webhook_secrets_active_idx" ON "webhook_secrets"("organization_id", "connector_id", "revoked_at", "expires_at");

CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");
CREATE UNIQUE INDEX "api_keys_token_hash_key" ON "api_keys"("token_hash");
CREATE UNIQUE INDEX "api_keys_id_org_key" ON "api_keys"("id", "organization_id");
CREATE INDEX "api_keys_connector_active_idx" ON "api_keys"("organization_id", "connector_id", "revoked_at");

CREATE UNIQUE INDEX "idempotency_records_org_scope_key" ON "idempotency_records"("organization_id", "scope", "key_hash");
CREATE INDEX "idempotency_records_expiry_idx" ON "idempotency_records"("organization_id", "expires_at");

ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_membership_id_organization_id_fkey"
FOREIGN KEY ("owner_membership_id", "organization_id") REFERENCES "memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "asset_dependencies" ADD CONSTRAINT "asset_dependencies_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_dependencies" ADD CONSTRAINT "asset_dependencies_source_asset_id_organization_id_fkey"
FOREIGN KEY ("source_asset_id", "organization_id") REFERENCES "assets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_dependencies" ADD CONSTRAINT "asset_dependencies_target_asset_id_organization_id_fkey"
FOREIGN KEY ("target_asset_id", "organization_id") REFERENCES "assets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "connectors" ADD CONSTRAINT "connectors_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "webhook_secrets" ADD CONSTRAINT "webhook_secrets_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_secrets" ADD CONSTRAINT "webhook_secrets_connector_id_organization_id_fkey"
FOREIGN KEY ("connector_id", "organization_id") REFERENCES "connectors"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_secrets" ADD CONSTRAINT "webhook_secrets_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_connector_id_organization_id_fkey"
FOREIGN KEY ("connector_id", "organization_id") REFERENCES "connectors"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description") VALUES
    (gen_random_uuid(), 'asset.read', 'Read organization assets and dependencies'),
    (gen_random_uuid(), 'asset.manage', 'Create, update and archive organization assets'),
    (gen_random_uuid(), 'connector.read', 'Read organization connectors and redacted credentials'),
    (gen_random_uuid(), 'connector.manage', 'Create, update and disable organization connectors'),
    (gen_random_uuid(), 'connector.secret.rotate', 'Rotate webhook secrets'),
    (gen_random_uuid(), 'api-key.read', 'Read redacted connector API keys'),
    (gen_random_uuid(), 'api-key.manage', 'Create and revoke connector API keys')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_id")
SELECT role."organization_id", role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON (
    role."key" IN ('owner', 'admin')
    AND permission."key" IN (
        'asset.read', 'asset.manage', 'connector.read', 'connector.manage',
        'connector.secret.rotate', 'api-key.read', 'api-key.manage'
    )
) OR (
    role."key" = 'analyst'
    AND permission."key" IN ('asset.read', 'asset.manage', 'connector.read')
) OR (
    role."key" = 'viewer'
    AND permission."key" IN ('asset.read', 'connector.read')
)
WHERE role."is_system" = TRUE
ON CONFLICT DO NOTHING;

GRANT USAGE ON TYPE "asset_type", "asset_criticality", "asset_status", "asset_dependency_kind", "connector_type", "connector_status", "idempotency_status" TO aegisflow_app;
GRANT SELECT, INSERT, UPDATE ON "assets", "connectors", "webhook_secrets", "api_keys", "idempotency_records" TO aegisflow_app;
GRANT SELECT, INSERT, DELETE ON "asset_dependencies" TO aegisflow_app;

ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "assets_tenant_policy" ON "assets" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "asset_dependencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_dependencies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "asset_dependencies_tenant_policy" ON "asset_dependencies" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "connectors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connectors" FORCE ROW LEVEL SECURITY;
CREATE POLICY "connectors_tenant_policy" ON "connectors" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "webhook_secrets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_secrets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "webhook_secrets_tenant_policy" ON "webhook_secrets" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY "api_keys_tenant_policy" ON "api_keys" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "idempotency_records_tenant_policy" ON "idempotency_records" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());
