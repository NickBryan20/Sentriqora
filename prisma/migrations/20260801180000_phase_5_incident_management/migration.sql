CREATE TYPE "incident_status" AS ENUM ('OPEN', 'TRIAGED', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED');
CREATE TYPE "incident_priority" AS ENUM ('P1', 'P2', 'P3', 'P4');
CREATE TYPE "incident_timeline_type" AS ENUM (
  'CREATED', 'ALERT_LINKED', 'ASSIGNED', 'STATUS_CHANGED', 'COMMENT_ADDED',
  'EVIDENCE_ADDED', 'ANALYSIS_UPDATED', 'SLA_BREACHED', 'NOTIFICATION_SENT'
);
CREATE TYPE "evidence_status" AS ENUM ('PENDING_UPLOAD', 'QUARANTINED', 'AVAILABLE', 'REJECTED');
CREATE TYPE "notification_channel" AS ENUM ('INTERNAL', 'EMAIL');
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "sla_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "severity" "event_severity" NOT NULL,
  "response_minutes" INTEGER NOT NULL,
  "resolution_minutes" INTEGER NOT NULL,
  "escalation_minutes" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sla_policies_name_check" CHECK (length(trim("name")) >= 3),
  CONSTRAINT "sla_policies_response_check" CHECK ("response_minutes" BETWEEN 1 AND 43200),
  CONSTRAINT "sla_policies_resolution_check" CHECK ("resolution_minutes" BETWEEN 5 AND 525600),
  CONSTRAINT "sla_policies_escalation_check" CHECK ("escalation_minutes" BETWEEN 1 AND 525600),
  CONSTRAINT "sla_policies_order_check" CHECK ("response_minutes" < "resolution_minutes"),
  CONSTRAINT "sla_policies_version_check" CHECK ("version" > 0)
);

CREATE TABLE "incidents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "primary_asset_id" UUID,
  "assigned_membership_id" UUID,
  "sla_policy_id" UUID,
  "key" VARCHAR(40) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(4000) NOT NULL DEFAULT '',
  "severity" "event_severity" NOT NULL,
  "priority" "incident_priority" NOT NULL,
  "status" "incident_status" NOT NULL DEFAULT 'OPEN',
  "risk_score" DECIMAL(6,3) NOT NULL,
  "first_detected_at" TIMESTAMPTZ(6) NOT NULL,
  "response_due_at" TIMESTAMPTZ(6) NOT NULL,
  "resolution_due_at" TIMESTAMPTZ(6) NOT NULL,
  "first_responded_at" TIMESTAMPTZ(6),
  "contained_at" TIMESTAMPTZ(6),
  "resolved_at" TIMESTAMPTZ(6),
  "closed_at" TIMESTAMPTZ(6),
  "response_breached_at" TIMESTAMPTZ(6),
  "resolution_breached_at" TIMESTAMPTZ(6),
  "root_cause" VARCHAR(5000),
  "lessons_learned" VARCHAR(5000),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "incidents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incidents_key_check" CHECK ("key" ~ '^INC-[A-Z0-9]{8,32}$'),
  CONSTRAINT "incidents_title_check" CHECK (length(trim("title")) >= 5),
  CONSTRAINT "incidents_risk_check" CHECK ("risk_score" BETWEEN 0 AND 100),
  CONSTRAINT "incidents_sla_order_check" CHECK (
    "response_due_at" > "first_detected_at" AND "resolution_due_at" > "response_due_at"
  ),
  CONSTRAINT "incidents_resolution_analysis_check" CHECK (
    "status" NOT IN ('RESOLVED', 'CLOSED') OR length(trim("root_cause")) >= 10
  ),
  CONSTRAINT "incidents_closure_analysis_check" CHECK (
    "status" <> 'CLOSED' OR length(trim("lessons_learned")) >= 10
  ),
  CONSTRAINT "incidents_version_check" CHECK ("version" > 0)
);

CREATE TABLE "incident_alerts" (
  "organization_id" UUID NOT NULL,
  "incident_id" UUID NOT NULL,
  "alert_id" UUID NOT NULL,
  "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incident_alerts_pkey" PRIMARY KEY ("organization_id", "incident_id", "alert_id")
);

CREATE TABLE "incident_events" (
  "organization_id" UUID NOT NULL,
  "incident_id" UUID NOT NULL,
  "normalized_event_id" UUID NOT NULL,
  "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incident_events_pkey" PRIMARY KEY ("organization_id", "incident_id", "normalized_event_id")
);

CREATE TABLE "incident_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "incident_id" UUID NOT NULL,
  "uploaded_by_user_id" UUID NOT NULL,
  "file_name" VARCHAR(180) NOT NULL,
  "content_type" VARCHAR(120) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "object_key" VARCHAR(500) NOT NULL,
  "status" "evidence_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "rejection_reason" VARCHAR(240),
  "scanned_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "incident_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incident_evidence_file_name_check" CHECK (
    length(trim("file_name")) > 0 AND "file_name" !~ '[/\\]' AND "file_name" NOT IN ('.', '..')
  ),
  CONSTRAINT "incident_evidence_content_type_check" CHECK ("content_type" IN (
    'application/json', 'application/pdf', 'text/csv', 'text/plain',
    'image/jpeg', 'image/png'
  )),
  CONSTRAINT "incident_evidence_size_check" CHECK ("size_bytes" BETWEEN 1 AND 10485760),
  CONSTRAINT "incident_evidence_hash_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "incident_evidence_version_check" CHECK ("version" > 0)
);

CREATE TABLE "incident_comments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "incident_id" UUID NOT NULL,
  "author_user_id" UUID NOT NULL,
  "body" VARCHAR(5000) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "incident_comments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incident_comments_body_check" CHECK (length(trim("body")) > 0),
  CONSTRAINT "incident_comments_version_check" CHECK ("version" > 0)
);

CREATE TABLE "incident_timeline_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "incident_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "type" "incident_timeline_type" NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "detail" VARCHAR(2000) NOT NULL DEFAULT '',
  "from_status" "incident_status",
  "to_status" "incident_status",
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "idempotency_key" CHAR(64),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incident_timeline_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incident_timeline_title_check" CHECK (length(trim("title")) > 0),
  CONSTRAINT "incident_timeline_metadata_check" CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "incident_timeline_idempotency_check" CHECK (
    "idempotency_key" IS NULL OR "idempotency_key" ~ '^[a-f0-9]{64}$'
  )
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "incident_id" UUID,
  "recipient_membership_id" UUID,
  "channel" "notification_channel" NOT NULL,
  "type" VARCHAR(80) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "status" "notification_status" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" CHAR(64) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "sent_at" TIMESTAMPTZ(6),
  "read_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(100),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_idempotency_check" CHECK ("idempotency_key" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "notifications_attempt_count_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "notifications_content_check" CHECK (
    length(trim("type")) > 0 AND length(trim("title")) > 0 AND length(trim("body")) > 0
  )
);

CREATE UNIQUE INDEX "sla_policies_org_severity_key" ON "sla_policies"("organization_id", "severity");
CREATE UNIQUE INDEX "sla_policies_id_org_key" ON "sla_policies"("id", "organization_id");
CREATE INDEX "sla_policies_org_enabled_idx" ON "sla_policies"("organization_id", "enabled");
CREATE UNIQUE INDEX "incidents_org_key_key" ON "incidents"("organization_id", "key");
CREATE UNIQUE INDEX "incidents_id_org_key" ON "incidents"("id", "organization_id");
CREATE INDEX "incidents_org_cursor_idx" ON "incidents"("organization_id", "status", "severity", "updated_at", "id");
CREATE INDEX "incidents_org_assignee_idx" ON "incidents"("organization_id", "assigned_membership_id", "status");
CREATE INDEX "incidents_org_response_sla_idx" ON "incidents"("organization_id", "response_due_at", "first_responded_at");
CREATE INDEX "incidents_org_resolution_sla_idx" ON "incidents"("organization_id", "resolution_due_at", "resolved_at");
CREATE UNIQUE INDEX "incident_alerts_org_alert_key" ON "incident_alerts"("organization_id", "alert_id");
CREATE INDEX "incident_alerts_org_incident_idx" ON "incident_alerts"("organization_id", "incident_id", "linked_at");
CREATE INDEX "incident_events_org_event_idx" ON "incident_events"("organization_id", "normalized_event_id");
CREATE UNIQUE INDEX "incident_evidence_object_key_key" ON "incident_evidence"("object_key");
CREATE UNIQUE INDEX "incident_evidence_id_org_key" ON "incident_evidence"("id", "organization_id");
CREATE UNIQUE INDEX "incident_evidence_org_incident_hash_key" ON "incident_evidence"("organization_id", "incident_id", "sha256");
CREATE INDEX "incident_evidence_org_incident_idx" ON "incident_evidence"("organization_id", "incident_id", "created_at");
CREATE UNIQUE INDEX "incident_comments_id_org_key" ON "incident_comments"("id", "organization_id");
CREATE INDEX "incident_comments_org_incident_idx" ON "incident_comments"("organization_id", "incident_id", "created_at");
CREATE UNIQUE INDEX "incident_timeline_org_idempotency_key" ON "incident_timeline_entries"("organization_id", "incident_id", "idempotency_key");
CREATE INDEX "incident_timeline_org_incident_idx" ON "incident_timeline_entries"("organization_id", "incident_id", "occurred_at", "id");
CREATE UNIQUE INDEX "notifications_org_idempotency_key" ON "notifications"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "notifications_id_org_key" ON "notifications"("id", "organization_id");
CREATE INDEX "notifications_org_recipient_idx" ON "notifications"("organization_id", "recipient_membership_id", "read_at", "created_at");
CREATE INDEX "notifications_status_idx" ON "notifications"("status", "created_at");

ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_primary_asset_id_organization_id_fkey" FOREIGN KEY ("primary_asset_id", "organization_id") REFERENCES "assets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assigned_membership_id_organization_id_fkey" FOREIGN KEY ("assigned_membership_id", "organization_id") REFERENCES "memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_sla_policy_id_organization_id_fkey" FOREIGN KEY ("sla_policy_id", "organization_id") REFERENCES "sla_policies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_alerts" ADD CONSTRAINT "incident_alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_alerts" ADD CONSTRAINT "incident_alerts_incident_id_organization_id_fkey" FOREIGN KEY ("incident_id", "organization_id") REFERENCES "incidents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_alerts" ADD CONSTRAINT "incident_alerts_alert_id_organization_id_fkey" FOREIGN KEY ("alert_id", "organization_id") REFERENCES "alerts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_organization_id_fkey" FOREIGN KEY ("incident_id", "organization_id") REFERENCES "incidents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_normalized_event_id_organization_id_fkey" FOREIGN KEY ("normalized_event_id", "organization_id") REFERENCES "normalized_events"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_evidence" ADD CONSTRAINT "incident_evidence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_evidence" ADD CONSTRAINT "incident_evidence_incident_id_organization_id_fkey" FOREIGN KEY ("incident_id", "organization_id") REFERENCES "incidents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_evidence" ADD CONSTRAINT "incident_evidence_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_comments" ADD CONSTRAINT "incident_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_comments" ADD CONSTRAINT "incident_comments_incident_id_organization_id_fkey" FOREIGN KEY ("incident_id", "organization_id") REFERENCES "incidents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_comments" ADD CONSTRAINT "incident_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_timeline_entries" ADD CONSTRAINT "incident_timeline_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_timeline_entries" ADD CONSTRAINT "incident_timeline_entries_incident_id_organization_id_fkey" FOREIGN KEY ("incident_id", "organization_id") REFERENCES "incidents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_timeline_entries" ADD CONSTRAINT "incident_timeline_entries_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_incident_id_organization_id_fkey" FOREIGN KEY ("incident_id", "organization_id") REFERENCES "incidents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_membership_id_organization_id_fkey" FOREIGN KEY ("recipient_membership_id", "organization_id") REFERENCES "memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description") VALUES
  (gen_random_uuid(), 'incident.read', 'Read incidents, timeline, comments and SLA state.'),
  (gen_random_uuid(), 'incident.manage', 'Create, assign, transition and analyze incidents.'),
  (gen_random_uuid(), 'incident.evidence', 'Request, verify and download private incident evidence.'),
  (gen_random_uuid(), 'sla-policy.manage', 'Configure incident response and resolution SLA policies.'),
  (gen_random_uuid(), 'notification.read', 'Read and acknowledge incident notifications.')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_id")
SELECT role."organization_id", role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."key" IN (
  'incident.read', 'incident.manage', 'incident.evidence', 'sla-policy.manage', 'notification.read'
)
WHERE role."key" IN ('owner', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_id")
SELECT role."organization_id", role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."key" IN (
  'incident.read', 'incident.manage', 'incident.evidence', 'notification.read'
)
WHERE role."key" = 'analyst'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_id")
SELECT role."organization_id", role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."key" IN ('incident.read', 'notification.read')
WHERE role."key" = 'viewer'
ON CONFLICT DO NOTHING;

INSERT INTO "sla_policies" (
  "organization_id", "name", "severity", "response_minutes", "resolution_minutes",
  "escalation_minutes", "updated_at"
)
SELECT organization."id", policy."name", policy."severity"::"event_severity",
       policy."response_minutes", policy."resolution_minutes", policy."escalation_minutes", now()
FROM "organizations" AS organization
CROSS JOIN (VALUES
  ('Critical response', 'CRITICAL', 5, 60, 10),
  ('High response', 'HIGH', 15, 240, 30),
  ('Medium response', 'MEDIUM', 30, 720, 60),
  ('Low response', 'LOW', 120, 1440, 240),
  ('Informational response', 'INFO', 240, 2880, 480)
) AS policy("name", "severity", "response_minutes", "resolution_minutes", "escalation_minutes")
ON CONFLICT ("organization_id", "severity") DO NOTHING;

GRANT USAGE ON TYPE "incident_status", "incident_priority", "incident_timeline_type",
  "evidence_status", "notification_channel", "notification_status" TO aegisflow_app;
GRANT SELECT, INSERT, UPDATE ON "incidents", "incident_evidence", "incident_comments",
  "incident_timeline_entries", "sla_policies", "notifications" TO aegisflow_app;
GRANT SELECT, INSERT ON "incident_alerts", "incident_events" TO aegisflow_app;

ALTER TABLE "incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incidents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "incidents_tenant_policy" ON "incidents" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "incident_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incident_alerts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "incident_alerts_tenant_policy" ON "incident_alerts" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "incident_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incident_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "incident_events_tenant_policy" ON "incident_events" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "incident_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incident_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "incident_evidence_tenant_policy" ON "incident_evidence" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "incident_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incident_comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "incident_comments_tenant_policy" ON "incident_comments" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "incident_timeline_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incident_timeline_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "incident_timeline_entries_tenant_policy" ON "incident_timeline_entries" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "sla_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sla_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "sla_policies_tenant_policy" ON "sla_policies" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notifications_tenant_policy" ON "notifications" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
