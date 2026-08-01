import { describe, expect, it } from 'vitest';

import {
  requestEvidenceUploadSchema,
  transitionIncidentSchema,
  updateSlaPolicySchema,
} from '../src/incidents';

describe('incident contracts', () => {
  it('accepts only bounded, private-evidence metadata', () => {
    expect(
      requestEvidenceUploadSchema.safeParse({
        contentType: 'application/json',
        fileName: 'event.json',
        sha256: 'a'.repeat(64),
        sizeBytes: 1024,
      }).success,
    ).toBe(true);
    expect(
      requestEvidenceUploadSchema.safeParse({
        contentType: 'application/x-msdownload',
        fileName: '../malware.exe',
        sha256: 'not-a-hash',
        sizeBytes: 20 * 1024 * 1024,
      }).success,
    ).toBe(false);
    expect(
      requestEvidenceUploadSchema.safeParse({
        contentType: 'application/pdf',
        fileName: 'misleading.json',
        sha256: 'a'.repeat(64),
        sizeBytes: 1024,
      }).success,
    ).toBe(false);
  });

  it('requires a reason and optimistic version for state transitions', () => {
    expect(
      transitionIncidentSchema.safeParse({
        reason: 'Investigation started by the response team',
        status: 'INVESTIGATING',
        version: 1,
      }).success,
    ).toBe(true);
    expect(transitionIncidentSchema.safeParse({ status: 'RESOLVED', version: 0 }).success).toBe(
      false,
    );
  });

  it('keeps response targets earlier than resolution targets', () => {
    expect(
      updateSlaPolicySchema.safeParse({
        enabled: true,
        escalationMinutes: 30,
        name: 'Critical response',
        resolutionMinutes: 60,
        responseMinutes: 5,
        version: 1,
      }).success,
    ).toBe(true);
    expect(
      updateSlaPolicySchema.safeParse({
        enabled: true,
        escalationMinutes: 30,
        name: 'Invalid response',
        resolutionMinutes: 60,
        responseMinutes: 60,
        version: 1,
      }).success,
    ).toBe(false);
  });
});
