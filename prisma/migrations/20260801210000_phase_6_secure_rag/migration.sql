CREATE TYPE "knowledge_trust_level" AS ENUM ('UNTRUSTED', 'INTERNAL', 'VERIFIED');
CREATE TYPE "knowledge_source_type" AS ENUM ('MANUAL', 'RUNBOOK', 'POLICY', 'VENDOR');
CREATE TYPE "knowledge_document_status" AS ENUM ('PENDING', 'INDEXING', 'INDEXED', 'REJECTED', 'DELETED');
CREATE TYPE "ai_recommendation_status" AS ENUM (
  'GENERATED', 'ABSTAINED', 'PROVIDER_UNAVAILABLE', 'INVALID_OUTPUT'
);

CREATE TABLE "knowledge_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "source_type" "knowledge_source_type" NOT NULL,
  "source_uri" VARCHAR(500),
  "trust_level" "knowledge_trust_level" NOT NULL,
  "status" "knowledge_document_status" NOT NULL DEFAULT 'PENDING',
  "current_version" INTEGER NOT NULL DEFAULT 1,
  "rejection_reason" VARCHAR(240),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_documents_title_check" CHECK (length(trim("title")) BETWEEN 3 AND 180),
  CONSTRAINT "knowledge_documents_version_check" CHECK ("current_version" > 0),
  CONSTRAINT "knowledge_documents_deleted_check" CHECK (
    ("status" = 'DELETED') = ("deleted_at" IS NOT NULL)
  )
);

CREATE TABLE "knowledge_document_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "object_key" VARCHAR(500) NOT NULL,
  "content_type" VARCHAR(80) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "embedding_provider" VARCHAR(40) NOT NULL,
  "embedding_model" VARCHAR(120) NOT NULL,
  "indexed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_document_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "knowledge_versions_content_type_check" CHECK ("content_type" IN ('text/plain', 'text/markdown')),
  CONSTRAINT "knowledge_versions_size_check" CHECK ("size_bytes" BETWEEN 40 AND 262144),
  CONSTRAINT "knowledge_versions_hash_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "knowledge_versions_provider_check" CHECK (
    length(trim("embedding_provider")) > 0 AND length(trim("embedding_model")) > 0
  )
);

CREATE TABLE "knowledge_chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "version_id" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "token_estimate" INTEGER NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "embedding" vector(768) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_chunks_ordinal_check" CHECK ("ordinal" >= 0),
  CONSTRAINT "knowledge_chunks_content_check" CHECK (length(trim("content")) > 0),
  CONSTRAINT "knowledge_chunks_tokens_check" CHECK ("token_estimate" BETWEEN 1 AND 8192),
  CONSTRAINT "knowledge_chunks_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "ai_recommendations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "incident_id" UUID,
  "requested_by_user_id" UUID NOT NULL,
  "question" VARCHAR(2000) NOT NULL,
  "answer" VARCHAR(6000) NOT NULL,
  "recommended_actions" JSONB NOT NULL DEFAULT '[]',
  "status" "ai_recommendation_status" NOT NULL,
  "confidence" DECIMAL(6,5) NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "prompt_version" VARCHAR(40) NOT NULL,
  "provider_request_id" VARCHAR(120),
  "latency_ms" INTEGER NOT NULL,
  "input_tokens" INTEGER NOT NULL,
  "output_tokens" INTEGER NOT NULL,
  "estimated_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_recommendations_question_check" CHECK (length(trim("question")) BETWEEN 8 AND 2000),
  CONSTRAINT "ai_recommendations_answer_check" CHECK (length(trim("answer")) BETWEEN 1 AND 6000),
  CONSTRAINT "ai_recommendations_actions_check" CHECK (jsonb_typeof("recommended_actions") = 'array'),
  CONSTRAINT "ai_recommendations_confidence_check" CHECK ("confidence" BETWEEN 0 AND 1),
  CONSTRAINT "ai_recommendations_telemetry_check" CHECK (
    "latency_ms" >= 0 AND "input_tokens" >= 0 AND "output_tokens" >= 0 AND "estimated_cost_usd" >= 0
  )
);

CREATE TABLE "ai_recommendation_sources" (
  "organization_id" UUID NOT NULL,
  "recommendation_id" UUID NOT NULL,
  "chunk_id" UUID NOT NULL,
  "rank" INTEGER NOT NULL,
  "similarity" DECIMAL(7,6) NOT NULL,
  "quote" VARCHAR(1200) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_recommendation_sources_pkey" PRIMARY KEY (
    "organization_id", "recommendation_id", "chunk_id"
  ),
  CONSTRAINT "ai_recommendation_sources_rank_check" CHECK ("rank" BETWEEN 1 AND 8),
  CONSTRAINT "ai_recommendation_sources_similarity_check" CHECK ("similarity" BETWEEN 0 AND 1),
  CONSTRAINT "ai_recommendation_sources_quote_check" CHECK (length(trim("quote")) > 0)
);

CREATE UNIQUE INDEX "knowledge_documents_id_org_key" ON "knowledge_documents"("id", "organization_id");
CREATE INDEX "knowledge_documents_org_cursor_idx" ON "knowledge_documents"("organization_id", "status", "updated_at", "id");
CREATE INDEX "knowledge_documents_org_trust_idx" ON "knowledge_documents"("organization_id", "trust_level", "status");
CREATE UNIQUE INDEX "knowledge_versions_object_key_key" ON "knowledge_document_versions"("object_key");
CREATE UNIQUE INDEX "knowledge_versions_id_org_key" ON "knowledge_document_versions"("id", "organization_id");
CREATE UNIQUE INDEX "knowledge_versions_org_doc_version_key" ON "knowledge_document_versions"("organization_id", "document_id", "version");
CREATE UNIQUE INDEX "knowledge_versions_org_doc_hash_key" ON "knowledge_document_versions"("organization_id", "document_id", "sha256");
CREATE INDEX "knowledge_versions_org_doc_idx" ON "knowledge_document_versions"("organization_id", "document_id", "created_at");
CREATE UNIQUE INDEX "knowledge_chunks_id_org_key" ON "knowledge_chunks"("id", "organization_id");
CREATE UNIQUE INDEX "knowledge_chunks_org_version_ordinal_key" ON "knowledge_chunks"("organization_id", "version_id", "ordinal");
CREATE INDEX "knowledge_chunks_org_document_idx" ON "knowledge_chunks"("organization_id", "document_id", "version_id");
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks"
  USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE UNIQUE INDEX "ai_recommendations_id_org_key" ON "ai_recommendations"("id", "organization_id");
CREATE INDEX "ai_recommendations_org_incident_idx" ON "ai_recommendations"("organization_id", "incident_id", "created_at");
CREATE INDEX "ai_recommendations_org_requester_idx" ON "ai_recommendations"("organization_id", "requested_by_user_id", "created_at");
CREATE UNIQUE INDEX "ai_recommendation_sources_org_rank_key" ON "ai_recommendation_sources"("organization_id", "recommendation_id", "rank");
CREATE INDEX "ai_recommendation_sources_org_chunk_idx" ON "ai_recommendation_sources"("organization_id", "chunk_id");

ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_versions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_versions_document_id_organization_id_fkey"
  FOREIGN KEY ("document_id", "organization_id") REFERENCES "knowledge_documents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_versions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_organization_id_fkey"
  FOREIGN KEY ("document_id", "organization_id") REFERENCES "knowledge_documents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_version_id_organization_id_fkey"
  FOREIGN KEY ("version_id", "organization_id") REFERENCES "knowledge_document_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_incident_id_organization_id_fkey"
  FOREIGN KEY ("incident_id", "organization_id") REFERENCES "incidents"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_requested_by_user_id_fkey"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_recommendation_sources" ADD CONSTRAINT "ai_recommendation_sources_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_recommendation_sources" ADD CONSTRAINT "ai_recommendation_sources_recommendation_id_organization_id_fkey"
  FOREIGN KEY ("recommendation_id", "organization_id") REFERENCES "ai_recommendations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_recommendation_sources" ADD CONSTRAINT "ai_recommendation_sources_chunk_id_organization_id_fkey"
  FOREIGN KEY ("chunk_id", "organization_id") REFERENCES "knowledge_chunks"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description") VALUES
  (gen_random_uuid(), 'knowledge.read', 'Read indexed knowledge documents and their sources.'),
  (gen_random_uuid(), 'knowledge.manage', 'Create, version and securely delete knowledge documents.'),
  (gen_random_uuid(), 'ai-recommendation.request', 'Request grounded AI recommendations with citations.')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_id")
SELECT role."organization_id", role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."key" IN (
  'knowledge.read', 'knowledge.manage', 'ai-recommendation.request'
)
WHERE role."key" IN ('owner', 'admin', 'analyst')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_id")
SELECT role."organization_id", role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."key" IN (
  'knowledge.read', 'ai-recommendation.request'
)
WHERE role."key" = 'viewer'
ON CONFLICT DO NOTHING;

GRANT USAGE ON TYPE "knowledge_trust_level", "knowledge_source_type",
  "knowledge_document_status", "ai_recommendation_status" TO aegisflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "knowledge_documents", "knowledge_document_versions",
  "knowledge_chunks", "ai_recommendations", "ai_recommendation_sources" TO aegisflow_app;

ALTER TABLE "knowledge_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_documents_tenant_policy" ON "knowledge_documents" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "knowledge_document_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_document_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_versions_tenant_policy" ON "knowledge_document_versions" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "knowledge_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_chunks_tenant_policy" ON "knowledge_chunks" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "ai_recommendations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_recommendations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_recommendations_tenant_policy" ON "ai_recommendations" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE "ai_recommendation_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_recommendation_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_recommendation_sources_tenant_policy" ON "ai_recommendation_sources" FOR ALL TO aegisflow_app
  USING ("organization_id" = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::uuid);
