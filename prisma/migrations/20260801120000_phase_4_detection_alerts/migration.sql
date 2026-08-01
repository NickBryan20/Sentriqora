CREATE TYPE "alert_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'SUPPRESSED', 'CLOSED');
CREATE TYPE "correlation_dimension" AS ENUM ('ACTOR_USER', 'SOURCE_IP', 'ASSET', 'EVENT_TYPE', 'FINGERPRINT');

CREATE TABLE "detection_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000) NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "severity" "event_severity" NOT NULL,
    "threshold" INTEGER NOT NULL DEFAULT 1,
    "window_seconds" INTEGER NOT NULL,
    "deduplication_window_seconds" INTEGER NOT NULL,
    "condition" JSONB NOT NULL,
    "correlation_dimensions" "correlation_dimension"[] NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "detection_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "detection_rules_key_check" CHECK ("key" ~ '^[a-z][a-z0-9._-]{2,79}$'),
    CONSTRAINT "detection_rules_threshold_check" CHECK ("threshold" BETWEEN 1 AND 10000),
    CONSTRAINT "detection_rules_window_check" CHECK ("window_seconds" BETWEEN 60 AND 86400),
    CONSTRAINT "detection_rules_dedup_window_check" CHECK ("deduplication_window_seconds" BETWEEN 60 AND 86400),
    CONSTRAINT "detection_rules_condition_check" CHECK (jsonb_typeof("condition") = 'object'),
    CONSTRAINT "detection_rules_dimensions_check" CHECK (cardinality("correlation_dimensions") BETWEEN 1 AND 3),
    CONSTRAINT "detection_rules_version_check" CHECK ("version" > 0)
);

CREATE TABLE "detection_rule_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "severity" "event_severity" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "window_seconds" INTEGER NOT NULL,
    "deduplication_window_seconds" INTEGER NOT NULL,
    "condition" JSONB NOT NULL,
    "correlation_dimensions" "correlation_dimension"[] NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "detection_rule_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "detection_rule_versions_version_check" CHECK ("version" > 0),
    CONSTRAINT "detection_rule_versions_threshold_check" CHECK ("threshold" BETWEEN 1 AND 10000),
    CONSTRAINT "detection_rule_versions_window_check" CHECK ("window_seconds" BETWEEN 60 AND 86400),
    CONSTRAINT "detection_rule_versions_dedup_window_check" CHECK ("deduplication_window_seconds" BETWEEN 60 AND 86400),
    CONSTRAINT "detection_rule_versions_condition_check" CHECK (jsonb_typeof("condition") = 'object'),
    CONSTRAINT "detection_rule_versions_dimensions_check" CHECK (cardinality("correlation_dimensions") BETWEEN 1 AND 3)
);

CREATE TABLE "rule_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "normalized_event_id" UUID NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "observed_count" INTEGER NOT NULL,
    "risk_score" DECIMAL(6,3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rule_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rule_executions_observed_count_check" CHECK ("observed_count" >= 0),
    CONSTRAINT "rule_executions_risk_check" CHECK ("risk_score" BETWEEN 0 AND 100),
    CONSTRAINT "rule_executions_duration_check" CHECK ("duration_ms" >= 0)
);

CREATE TABLE "anomaly_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "normalized_event_id" UUID NOT NULL,
    "algorithm" VARCHAR(40) NOT NULL DEFAULT 'zscore-hourly-v1',
    "baseline_mean" DECIMAL(14,6) NOT NULL,
    "baseline_stddev" DECIMAL(14,6) NOT NULL,
    "moving_average" DECIMAL(14,6) NOT NULL,
    "observed_value" DECIMAL(14,6) NOT NULL,
    "score" DECIMAL(8,4) NOT NULL,
    "is_anomalous" BOOLEAN NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "anomaly_scores_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "anomaly_scores_values_check" CHECK (
      "baseline_mean" >= 0 AND "baseline_stddev" >= 0 AND "moving_average" >= 0
      AND "observed_value" >= 0 AND "score" BETWEEN 0 AND 10
    )
);

CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "asset_id" UUID,
    "assigned_membership_id" UUID,
    "deduplication_key" CHAR(64) NOT NULL,
    "correlation_key" VARCHAR(512) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "severity" "event_severity" NOT NULL,
    "status" "alert_status" NOT NULL DEFAULT 'OPEN',
    "risk_score" DECIMAL(6,3) NOT NULL,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(6),
    "suppressed_until" TIMESTAMPTZ(6),
    "suppression_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "alerts_dedup_key_check" CHECK ("deduplication_key" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "alerts_correlation_key_check" CHECK (length("correlation_key") > 0),
    CONSTRAINT "alerts_risk_check" CHECK ("risk_score" BETWEEN 0 AND 100),
    CONSTRAINT "alerts_occurrence_check" CHECK ("occurrence_count" > 0),
    CONSTRAINT "alerts_time_check" CHECK ("last_seen_at" >= "first_seen_at"),
    CONSTRAINT "alerts_suppression_check" CHECK (
      ("status" = 'SUPPRESSED' AND "suppressed_until" IS NOT NULL AND "suppression_reason" IS NOT NULL)
      OR "status" <> 'SUPPRESSED'
    ),
    CONSTRAINT "alerts_version_check" CHECK ("version" > 0)
);

CREATE TABLE "alert_events" (
    "organization_id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "normalized_event_id" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("organization_id", "alert_id", "normalized_event_id")
);

CREATE TABLE "alert_correlation_edges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_alert_id" UUID NOT NULL,
    "target_alert_id" UUID NOT NULL,
    "dimension" "correlation_dimension" NOT NULL,
    "value_hash" CHAR(64) NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "alert_correlation_edges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "alert_correlation_distinct_check" CHECK ("source_alert_id" <> "target_alert_id"),
    CONSTRAINT "alert_correlation_hash_check" CHECK ("value_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "alert_correlation_weight_check" CHECK ("weight" > 0)
);

CREATE UNIQUE INDEX "detection_rules_org_key_key" ON "detection_rules"("organization_id", "key");
CREATE UNIQUE INDEX "detection_rules_id_org_key" ON "detection_rules"("id", "organization_id");
CREATE INDEX "detection_rules_org_enabled_idx" ON "detection_rules"("organization_id", "enabled", "updated_at");
CREATE UNIQUE INDEX "detection_rule_versions_org_rule_version_key" ON "detection_rule_versions"("organization_id", "rule_id", "version");
CREATE UNIQUE INDEX "detection_rule_versions_id_org_key" ON "detection_rule_versions"("id", "organization_id");
CREATE UNIQUE INDEX "rule_executions_org_version_event_key" ON "rule_executions"("organization_id", "rule_version_id", "normalized_event_id");
CREATE INDEX "rule_executions_org_rule_time_idx" ON "rule_executions"("organization_id", "rule_id", "executed_at");
CREATE UNIQUE INDEX "anomaly_scores_org_event_algorithm_key" ON "anomaly_scores"("organization_id", "normalized_event_id", "algorithm");
CREATE INDEX "anomaly_scores_org_anomalous_idx" ON "anomaly_scores"("organization_id", "is_anomalous", "calculated_at");
CREATE UNIQUE INDEX "alerts_org_dedup_key" ON "alerts"("organization_id", "deduplication_key");
CREATE UNIQUE INDEX "alerts_id_org_key" ON "alerts"("id", "organization_id");
CREATE INDEX "alerts_org_cursor_idx" ON "alerts"("organization_id", "status", "severity", "last_seen_at", "id");
CREATE INDEX "alerts_org_assignee_idx" ON "alerts"("organization_id", "assigned_membership_id", "status");
CREATE INDEX "alert_events_org_event_idx" ON "alert_events"("organization_id", "normalized_event_id");
CREATE UNIQUE INDEX "alert_correlations_edge_key" ON "alert_correlation_edges"("organization_id", "source_alert_id", "target_alert_id", "dimension", "value_hash");
CREATE INDEX "alert_correlations_source_idx" ON "alert_correlation_edges"("organization_id", "source_alert_id", "last_seen_at");
CREATE INDEX "alert_correlations_target_idx" ON "alert_correlation_edges"("organization_id", "target_alert_id", "last_seen_at");

ALTER TABLE "detection_rules" ADD CONSTRAINT "detection_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "detection_rules" ADD CONSTRAINT "detection_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "detection_rules" ADD CONSTRAINT "detection_rules_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "detection_rule_versions" ADD CONSTRAINT "detection_rule_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "detection_rule_versions" ADD CONSTRAINT "detection_rule_versions_rule_id_organization_id_fkey" FOREIGN KEY ("rule_id", "organization_id") REFERENCES "detection_rules"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_rule_id_organization_id_fkey" FOREIGN KEY ("rule_id", "organization_id") REFERENCES "detection_rules"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_rule_version_id_organization_id_fkey" FOREIGN KEY ("rule_version_id", "organization_id") REFERENCES "detection_rule_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_normalized_event_id_organization_id_fkey" FOREIGN KEY ("normalized_event_id", "organization_id") REFERENCES "normalized_events"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "anomaly_scores" ADD CONSTRAINT "anomaly_scores_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "anomaly_scores" ADD CONSTRAINT "anomaly_scores_normalized_event_id_organization_id_fkey" FOREIGN KEY ("normalized_event_id", "organization_id") REFERENCES "normalized_events"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_rule_id_organization_id_fkey" FOREIGN KEY ("rule_id", "organization_id") REFERENCES "detection_rules"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_asset_id_organization_id_fkey" FOREIGN KEY ("asset_id", "organization_id") REFERENCES "assets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_assigned_membership_id_organization_id_fkey" FOREIGN KEY ("assigned_membership_id", "organization_id") REFERENCES "memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_id_organization_id_fkey" FOREIGN KEY ("alert_id", "organization_id") REFERENCES "alerts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_normalized_event_id_organization_id_fkey" FOREIGN KEY ("normalized_event_id", "organization_id") REFERENCES "normalized_events"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alert_correlation_edges" ADD CONSTRAINT "alert_correlation_edges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alert_correlation_edges" ADD CONSTRAINT "alert_correlation_edges_source_alert_id_organization_id_fkey" FOREIGN KEY ("source_alert_id", "organization_id") REFERENCES "alerts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alert_correlation_edges" ADD CONSTRAINT "alert_correlation_edges_target_alert_id_organization_id_fkey" FOREIGN KEY ("target_alert_id", "organization_id") REFERENCES "alerts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description") VALUES
  (gen_random_uuid(), 'detection-rule.read', 'Read detection rules and execution history.'),
  (gen_random_uuid(), 'detection-rule.manage', 'Create, update, enable and disable detection rules.'),
  (gen_random_uuid(), 'alert.read', 'Read alerts, anomaly scores and correlation graphs.'),
  (gen_random_uuid(), 'alert.triage', 'Acknowledge, assign, suppress and close alerts.')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_id")
SELECT role."organization_id", role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."key" IN (
  'detection-rule.read', 'detection-rule.manage', 'alert.read', 'alert.triage'
)
WHERE role."key" IN ('owner', 'admin', 'analyst')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_id")
SELECT role."organization_id", role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."key" IN ('detection-rule.read', 'alert.read')
WHERE role."key" = 'viewer'
ON CONFLICT DO NOTHING;

GRANT USAGE ON TYPE "alert_status", "correlation_dimension" TO aegisflow_app;
GRANT SELECT, INSERT, UPDATE ON "detection_rules" TO aegisflow_app;
GRANT SELECT, INSERT ON "detection_rule_versions", "rule_executions", "anomaly_scores", "alert_events" TO aegisflow_app;
GRANT SELECT, INSERT, UPDATE ON "alerts", "alert_correlation_edges" TO aegisflow_app;

ALTER TABLE "detection_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "detection_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "detection_rules_tenant_policy" ON "detection_rules" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "detection_rule_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "detection_rule_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "detection_rule_versions_tenant_policy" ON "detection_rule_versions" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "rule_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rule_executions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "rule_executions_tenant_policy" ON "rule_executions" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "anomaly_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "anomaly_scores" FORCE ROW LEVEL SECURITY;
CREATE POLICY "anomaly_scores_tenant_policy" ON "anomaly_scores" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alerts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "alerts_tenant_policy" ON "alerts" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "alert_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alert_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "alert_events_tenant_policy" ON "alert_events" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "alert_correlation_edges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alert_correlation_edges" FORCE ROW LEVEL SECURITY;
CREATE POLICY "alert_correlation_edges_tenant_policy" ON "alert_correlation_edges" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
