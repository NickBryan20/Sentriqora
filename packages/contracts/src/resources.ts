import { z } from 'zod';

export const ASSET_TYPES = [
  'APPLICATION',
  'SERVER',
  'API',
  'DATABASE',
  'REPOSITORY',
  'OTHER',
] as const;
export const ASSET_CRITICALITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const ASSET_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const ASSET_DEPENDENCY_KINDS = [
  'DEPENDS_ON',
  'HOSTED_ON',
  'CONNECTS_TO',
  'STORES_DATA_IN',
  'USES',
] as const;
export const CONNECTOR_TYPES = [
  'WEBHOOK',
  'REST_API',
  'JSON_IMPORT',
  'CSV_IMPORT',
  'GITHUB',
  'SIMULATOR',
] as const;
export const CONNECTOR_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export const API_KEY_SCOPES = ['connector.ingest', 'connector.health'] as const;

const resourceKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9._-]{1,63}$/u);
const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-zA-Z0-9._:-]+$/u),
  )
  .max(20)
  .default([]);
const connectorConfigurationValueSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string().max(500),
  z.null(),
  z.array(z.string().max(120)).max(20),
]);
const connectorConfigurationSchema = z
  .record(z.string().min(1).max(40), connectorConfigurationValueSchema)
  .refine((value) => Object.keys(value).length <= 20, 'Too many configuration properties');

export const createAssetSchema = z
  .object({
    criticality: z.enum(ASSET_CRITICALITIES),
    description: z.string().trim().max(500).default(''),
    key: resourceKeySchema,
    name: z.string().trim().min(2).max(120),
    ownerMembershipId: z.uuid().nullable().optional(),
    tags: tagsSchema,
    type: z.enum(ASSET_TYPES),
  })
  .strict();

export const updateAssetSchema = z
  .object({
    criticality: z.enum(ASSET_CRITICALITIES).optional(),
    description: z.string().trim().max(500).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    ownerMembershipId: z.uuid().nullable().optional(),
    tags: tagsSchema.optional(),
    version: z.number().int().positive(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), 'No changes supplied');

export const createAssetDependencySchema = z
  .object({
    description: z.string().trim().max(240).default(''),
    kind: z.enum(ASSET_DEPENDENCY_KINDS),
    targetAssetId: z.uuid(),
  })
  .strict();

export const createConnectorSchema = z
  .object({
    configuration: connectorConfigurationSchema.default({}),
    description: z.string().trim().max(500).default(''),
    key: resourceKeySchema,
    name: z.string().trim().min(2).max(120),
    type: z.enum(CONNECTOR_TYPES),
  })
  .strict();

export const updateConnectorSchema = z
  .object({
    configuration: connectorConfigurationSchema.optional(),
    description: z.string().trim().max(500).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(CONNECTOR_STATUSES).optional(),
    version: z.number().int().positive(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), 'No changes supplied');

export const rotateWebhookSecretSchema = z
  .object({ gracePeriodSeconds: z.number().int().min(0).max(86_400).default(300) })
  .strict();

export const createApiKeySchema = z
  .object({
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    name: z.string().trim().min(2).max(120),
    scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length),
  })
  .strict();

export type AssetCriticalityValue = (typeof ASSET_CRITICALITIES)[number];
export type AssetDependencyKindValue = (typeof ASSET_DEPENDENCY_KINDS)[number];
export type AssetStatusValue = (typeof ASSET_STATUSES)[number];
export type AssetTypeValue = (typeof ASSET_TYPES)[number];
export type ConnectorStatusValue = (typeof CONNECTOR_STATUSES)[number];
export type ConnectorTypeValue = (typeof CONNECTOR_TYPES)[number];
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type CreateAssetDependencyInput = z.infer<typeof createAssetDependencySchema>;
export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type CreateConnectorInput = z.infer<typeof createConnectorSchema>;
export type RotateWebhookSecretInput = z.infer<typeof rotateWebhookSecretSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type UpdateConnectorInput = z.infer<typeof updateConnectorSchema>;
