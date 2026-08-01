import { z } from 'zod';

import { EVENT_SEVERITIES } from './events';

export const INCIDENT_STATUSES = [
  'OPEN',
  'TRIAGED',
  'INVESTIGATING',
  'CONTAINED',
  'RESOLVED',
  'CLOSED',
] as const;
export const INCIDENT_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export const EVIDENCE_STATUSES = [
  'PENDING_UPLOAD',
  'QUARANTINED',
  'AVAILABLE',
  'REJECTED',
] as const;
export const NOTIFICATION_CHANNELS = ['INTERNAL', 'EMAIL'] as const;
export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_CONTENT_TYPES = [
  'application/json',
  'application/pdf',
  'text/csv',
  'text/plain',
  'image/jpeg',
  'image/png',
] as const;

const EVIDENCE_EXTENSIONS: Readonly<
  Record<(typeof EVIDENCE_CONTENT_TYPES)[number], readonly string[]>
> = {
  'application/json': ['.json'],
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpeg', '.jpg'],
  'image/png': ['.png'],
  'text/csv': ['.csv'],
  'text/plain': ['.log', '.txt'],
};

const safeFileName = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine(
    (value) =>
      !value.includes('/') &&
      !value.includes('\\') &&
      value !== '.' &&
      value !== '..' &&
      ![...value].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      }),
    'Unsafe file name.',
  );

export const createIncidentSchema = z
  .object({
    alertIds: z.array(z.uuid()).min(1).max(20),
    description: z.string().trim().max(4_000).default(''),
    severity: z.enum(EVENT_SEVERITIES).optional(),
    title: z.string().trim().min(5).max(200),
  })
  .strict();

export const assignIncidentSchema = z
  .object({
    assignedMembershipId: z.uuid().nullable(),
    version: z.number().int().min(1),
  })
  .strict();

export const transitionIncidentSchema = z
  .object({
    lessonsLearned: z.string().trim().min(10).max(5_000).optional(),
    reason: z.string().trim().min(5).max(1_000),
    rootCause: z.string().trim().min(10).max(5_000).optional(),
    status: z.enum(INCIDENT_STATUSES),
    version: z.number().int().min(1),
  })
  .strict();

export const updateIncidentAnalysisSchema = z
  .object({
    lessonsLearned: z.string().trim().min(10).max(5_000).nullable().optional(),
    rootCause: z.string().trim().min(10).max(5_000).nullable().optional(),
    version: z.number().int().min(1),
  })
  .strict()
  .refine(
    (value) => value.lessonsLearned !== undefined || value.rootCause !== undefined,
    'No analysis changes supplied.',
  );

export const addIncidentCommentSchema = z
  .object({ body: z.string().trim().min(1).max(5_000) })
  .strict();

export const requestEvidenceUploadSchema = z
  .object({
    contentType: z.enum(EVIDENCE_CONTENT_TYPES),
    fileName: safeFileName,
    sha256: z
      .string()
      .toLowerCase()
      .regex(/^[a-f0-9]{64}$/u),
    sizeBytes: z.number().int().min(1).max(MAX_EVIDENCE_BYTES),
  })
  .strict()
  .superRefine((value, context) => {
    const normalized = value.fileName.toLowerCase();
    if (
      !EVIDENCE_EXTENSIONS[value.contentType].some((extension) => normalized.endsWith(extension))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'File extension does not match the declared content type.',
        path: ['fileName'],
      });
    }
  });

export const completeEvidenceUploadSchema = z.object({ version: z.number().int().min(1) }).strict();

export const updateSlaPolicySchema = z
  .object({
    enabled: z.boolean(),
    escalationMinutes: z.number().int().min(1).max(525_600),
    name: z.string().trim().min(3).max(120),
    resolutionMinutes: z.number().int().min(5).max(525_600),
    responseMinutes: z.number().int().min(1).max(43_200),
    version: z.number().int().min(1),
  })
  .strict()
  .refine((value) => value.responseMinutes < value.resolutionMinutes, {
    message: 'Response target must be earlier than resolution target.',
  });

export const markNotificationReadSchema = z.object({ read: z.literal(true) }).strict();

export type AddIncidentCommentInput = z.infer<typeof addIncidentCommentSchema>;
export type AssignIncidentInput = z.infer<typeof assignIncidentSchema>;
export type CompleteEvidenceUploadInput = z.infer<typeof completeEvidenceUploadSchema>;
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
export type EvidenceContentTypeValue = (typeof EVIDENCE_CONTENT_TYPES)[number];
export type EvidenceStatusValue = (typeof EVIDENCE_STATUSES)[number];
export type IncidentPriorityValue = (typeof INCIDENT_PRIORITIES)[number];
export type IncidentStatusValue = (typeof INCIDENT_STATUSES)[number];
export type NotificationChannelValue = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationStatusValue = (typeof NOTIFICATION_STATUSES)[number];
export type RequestEvidenceUploadInput = z.infer<typeof requestEvidenceUploadSchema>;
export type TransitionIncidentInput = z.infer<typeof transitionIncidentSchema>;
export type UpdateIncidentAnalysisInput = z.infer<typeof updateIncidentAnalysisSchema>;
export type UpdateSlaPolicyInput = z.infer<typeof updateSlaPolicySchema>;
