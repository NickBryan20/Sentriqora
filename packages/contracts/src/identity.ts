import { z } from 'zod';

const emailSchema = z.email().max(254);
const organizationNameSchema = z.string().trim().min(2).max(120);
const passwordSchema = z.string().min(14).max(128);

export const registerIdentitySchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    email: emailSchema,
    organizationName: organizationNameSchema,
    organizationSlug: z.string().trim().min(2).max(80).optional(),
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    deviceName: z.string().trim().min(2).max(120),
    email: emailSchema,
    organizationId: z.uuid(),
    password: passwordSchema,
  })
  .strict();

export const verifyMfaLoginSchema = z
  .object({
    challengeId: z.uuid(),
    code: z.string().trim().min(6).max(32),
    deviceName: z.string().trim().min(2).max(120),
    organizationId: z.uuid(),
  })
  .strict();

export const confirmMfaEnrollmentSchema = z.object({ code: z.string().regex(/^\d{6}$/u) }).strict();

export const createOrganizationSchema = z
  .object({
    name: organizationNameSchema,
    slug: z.string().trim().min(2).max(80).optional(),
  })
  .strict();

export const createInvitationSchema = z
  .object({
    email: emailSchema,
    roleId: z.uuid(),
  })
  .strict();

export const acceptInvitationSchema = z
  .object({
    organizationId: z.uuid(),
    token: z.string().min(32).max(256),
  })
  .strict();

export const createRoleSchema = z
  .object({
    description: z.string().trim().min(2).max(240),
    key: z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/u),
    name: z.string().trim().min(2).max(80),
    permissions: z.array(z.string().min(3).max(100)).min(1).max(50),
  })
  .strict();

export const replaceMembershipRolesSchema = z
  .object({ roleIds: z.array(z.uuid()).min(1).max(10) })
  .strict();

export const authPrincipalSchema = z.object({
  mfaVerified: z.boolean(),
  organizationId: z.uuid(),
  permissions: z.array(z.string()),
  sessionId: z.uuid(),
  userId: z.uuid(),
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type AuthPrincipal = z.infer<typeof authPrincipalSchema>;
export type ConfirmMfaEnrollmentInput = z.infer<typeof confirmMfaEnrollmentSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterIdentityInput = z.infer<typeof registerIdentitySchema>;
export type ReplaceMembershipRolesInput = z.infer<typeof replaceMembershipRolesSchema>;
export type VerifyMfaLoginInput = z.infer<typeof verifyMfaLoginSchema>;
