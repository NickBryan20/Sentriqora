import { z } from 'zod';

import { EVENT_SEVERITIES } from './events';

export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'SUPPRESSED', 'CLOSED'] as const;
export const DETECTION_OPERATORS = ['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'GTE', 'LTE'] as const;
export const CORRELATION_DIMENSIONS = [
  'ACTOR_USER',
  'SOURCE_IP',
  'ASSET',
  'EVENT_TYPE',
  'FINGERPRINT',
] as const;

const ruleKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9._-]{2,79}$/u);
const attributeConditionSchema = z
  .object({
    operator: z.enum(DETECTION_OPERATORS),
    path: z
      .string()
      .trim()
      .regex(/^[a-zA-Z][a-zA-Z0-9._-]{0,119}$/u),
    value: z.union([z.string().max(500), z.number().finite(), z.boolean()]),
  })
  .strict();

export const detectionRuleConditionSchema = z
  .object({
    assetIds: z.array(z.uuid()).max(50).optional(),
    attributes: z.array(attributeConditionSchema).max(10).default([]),
    eventTypes: z
      .array(z.string().regex(/^[a-z][a-z0-9._-]{1,119}$/u))
      .max(25)
      .optional(),
    messageContains: z.string().trim().min(2).max(100).optional(),
    severities: z.array(z.enum(EVENT_SEVERITIES)).max(EVENT_SEVERITIES.length).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.assetIds?.length ?? 0) > 0 ||
      value.attributes.length > 0 ||
      (value.eventTypes?.length ?? 0) > 0 ||
      value.messageContains !== undefined ||
      (value.severities?.length ?? 0) > 0,
    'At least one deterministic condition is required.',
  );

export const createDetectionRuleSchema = z
  .object({
    condition: detectionRuleConditionSchema,
    correlationDimensions: z
      .array(z.enum(CORRELATION_DIMENSIONS))
      .min(1)
      .max(3)
      .default(['FINGERPRINT']),
    deduplicationWindowSeconds: z.number().int().min(60).max(86_400).default(900),
    description: z.string().trim().max(1_000).default(''),
    enabled: z.boolean().default(false),
    key: ruleKey,
    name: z.string().trim().min(3).max(120),
    severity: z.enum(EVENT_SEVERITIES),
    threshold: z.number().int().min(1).max(10_000).default(1),
    windowSeconds: z.number().int().min(60).max(86_400).default(300),
  })
  .strict();

export const updateDetectionRuleSchema = createDetectionRuleSchema
  .omit({ enabled: true, key: true })
  .partial()
  .extend({ version: z.number().int().min(1) })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), 'No changes supplied.');

export const setDetectionRuleEnabledSchema = z
  .object({ enabled: z.boolean(), version: z.number().int().min(1) })
  .strict();

export const triageAlertSchema = z
  .object({
    assignedMembershipId: z.uuid().nullable().optional(),
    status: z.enum(['ACKNOWLEDGED', 'CLOSED']),
    version: z.number().int().min(1),
  })
  .strict();

export const suppressAlertSchema = z
  .object({
    reason: z.string().trim().min(5).max(500),
    suppressedUntil: z.iso.datetime({ offset: true }),
    version: z.number().int().min(1),
  })
  .strict();

export type AlertStatusValue = (typeof ALERT_STATUSES)[number];
export type CorrelationDimensionValue = (typeof CORRELATION_DIMENSIONS)[number];
export type CreateDetectionRuleInput = z.infer<typeof createDetectionRuleSchema>;
export type DetectionOperatorValue = (typeof DETECTION_OPERATORS)[number];
export type DetectionRuleCondition = z.infer<typeof detectionRuleConditionSchema>;
export type SetDetectionRuleEnabledInput = z.infer<typeof setDetectionRuleEnabledSchema>;
export type SuppressAlertInput = z.infer<typeof suppressAlertSchema>;
export type TriageAlertInput = z.infer<typeof triageAlertSchema>;
export type UpdateDetectionRuleInput = z.infer<typeof updateDetectionRuleSchema>;
