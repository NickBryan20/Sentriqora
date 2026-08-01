CREATE TYPE "raw_event_status" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSING', 'NORMALIZED', 'REJECTED', 'FAILED');
CREATE TYPE "event_format" AS ENUM ('JSON', 'CSV');
CREATE TYPE "event_severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "raw_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "format" "event_format" NOT NULL,
    "status" "raw_event_status" NOT NULL DEFAULT 'RECEIVED',
    "content_type" VARCHAR(120) NOT NULL,
    "source_event_id" VARCHAR(128),
    "deduplication_key" CHAR(64) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "encrypted_payload" TEXT NOT NULL,
    "encryption_iv" VARCHAR(32) NOT NULL,
    "encryption_auth_tag" VARCHAR(32) NOT NULL,
    "payload_size" INTEGER NOT NULL,
    "record_count" INTEGER NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "rejection_code" VARCHAR(80),
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queued_at" TIMESTAMPTZ(6),
    "processed_at" TIMESTAMPTZ(6),
    "retention_until" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "raw_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "raw_events_payload_size_check" CHECK ("payload_size" BETWEEN 1 AND 1048576),
    CONSTRAINT "raw_events_record_count_check" CHECK ("record_count" BETWEEN 1 AND 500),
    CONSTRAINT "raw_events_retry_count_check" CHECK ("retry_count" BETWEEN 0 AND 20),
    CONSTRAINT "raw_events_retention_check" CHECK ("retention_until" > "received_at"),
    CONSTRAINT "raw_events_processed_state_check" CHECK (
        ("status" IN ('NORMALIZED', 'REJECTED') AND "processed_at" IS NOT NULL)
        OR ("status" NOT IN ('NORMALIZED', 'REJECTED'))
    )
);

CREATE TABLE "normalized_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "raw_event_id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "asset_id" UUID,
    "record_index" INTEGER NOT NULL,
    "source_event_id" VARCHAR(128),
    "event_type" VARCHAR(120) NOT NULL,
    "severity" "event_severity" NOT NULL,
    "message" VARCHAR(2000) NOT NULL DEFAULT '',
    "actor_user_hash" CHAR(64),
    "source_ip_hash" CHAR(64),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "fingerprint" CHAR(64) NOT NULL,
    "schema_version" VARCHAR(20) NOT NULL DEFAULT '1.0',
    "masking_version" VARCHAR(20) NOT NULL DEFAULT '1.0',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "normalized_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retention_until" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "normalized_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "normalized_events_record_index_check" CHECK ("record_index" BETWEEN 0 AND 499),
    CONSTRAINT "normalized_events_attributes_check" CHECK (jsonb_typeof("attributes") = 'object'),
    CONSTRAINT "normalized_events_retention_check" CHECK ("retention_until" > "received_at")
);

CREATE UNIQUE INDEX "raw_events_org_connector_dedup_key"
    ON "raw_events"("organization_id", "connector_id", "deduplication_key");
CREATE UNIQUE INDEX "raw_events_id_org_key" ON "raw_events"("id", "organization_id");
CREATE INDEX "raw_events_org_status_received_idx"
    ON "raw_events"("organization_id", "status", "received_at");
CREATE INDEX "raw_events_dispatch_idx" ON "raw_events"("status", "received_at");
CREATE INDEX "raw_events_retention_idx" ON "raw_events"("retention_until");

CREATE UNIQUE INDEX "normalized_events_raw_record_key"
    ON "normalized_events"("raw_event_id", "record_index");
CREATE UNIQUE INDEX "normalized_events_id_org_key"
    ON "normalized_events"("id", "organization_id");
CREATE INDEX "normalized_events_org_cursor_idx"
    ON "normalized_events"("organization_id", "occurred_at", "id");
CREATE INDEX "normalized_events_org_severity_idx"
    ON "normalized_events"("organization_id", "severity", "occurred_at");
CREATE INDEX "normalized_events_org_type_idx"
    ON "normalized_events"("organization_id", "event_type", "occurred_at");
CREATE INDEX "normalized_events_org_asset_idx"
    ON "normalized_events"("organization_id", "asset_id", "occurred_at");
CREATE INDEX "normalized_events_retention_idx" ON "normalized_events"("retention_until");

ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_connector_id_organization_id_fkey"
FOREIGN KEY ("connector_id", "organization_id") REFERENCES "connectors"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "normalized_events" ADD CONSTRAINT "normalized_events_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "normalized_events" ADD CONSTRAINT "normalized_events_raw_event_id_organization_id_fkey"
FOREIGN KEY ("raw_event_id", "organization_id") REFERENCES "raw_events"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "normalized_events" ADD CONSTRAINT "normalized_events_connector_id_organization_id_fkey"
FOREIGN KEY ("connector_id", "organization_id") REFERENCES "connectors"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "normalized_events" ADD CONSTRAINT "normalized_events_asset_id_organization_id_fkey"
FOREIGN KEY ("asset_id", "organization_id") REFERENCES "assets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description")
VALUES (gen_random_uuid(), 'event.read', 'Read masked normalized events and ingestion status')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_id")
SELECT role."organization_id", role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."key" = 'event.read'
WHERE role."is_system" = TRUE AND role."key" IN ('owner', 'admin', 'analyst', 'viewer')
ON CONFLICT DO NOTHING;

GRANT USAGE ON TYPE "raw_event_status", "event_format", "event_severity" TO aegisflow_app;
GRANT SELECT, INSERT, UPDATE ON "raw_events" TO aegisflow_app;
GRANT SELECT, INSERT ON "normalized_events" TO aegisflow_app;

ALTER TABLE "raw_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "raw_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "raw_events_tenant_policy" ON "raw_events" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

ALTER TABLE "normalized_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "normalized_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "normalized_events_tenant_policy" ON "normalized_events" FOR ALL TO aegisflow_app
USING ("organization_id" = aegisflow_current_organization_id())
WITH CHECK ("organization_id" = aegisflow_current_organization_id());

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegisflow_outbox') THEN
        CREATE ROLE aegisflow_outbox NOLOGIN BYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO aegisflow_outbox;
GRANT USAGE ON TYPE "outbox_status" TO aegisflow_outbox;
GRANT SELECT, UPDATE ON "outbox_events" TO aegisflow_outbox;
