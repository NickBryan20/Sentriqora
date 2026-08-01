import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Environment } from '../src/configuration';
import { MinioEvidenceStorageAdapter } from '../src/incidents/infrastructure/minio-evidence-storage.adapter';

function adapter(): MinioEvidenceStorageAdapter {
  const values: Record<string, string> = {
    MINIO_ACCESS_KEY: 'local-access',
    MINIO_BUCKET_EVIDENCE: 'private-evidence',
    MINIO_ENDPOINT: 'http://minio:9000',
    MINIO_PUBLIC_ENDPOINT: 'http://localhost:9000',
    MINIO_SECRET_KEY: 'local-secret',
  };
  const config = { get: (key: string) => values[key] } as ConfigService<Environment, true>;
  return new MinioEvidenceStorageAdapter(config);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MinioEvidenceStorageAdapter', () => {
  it('creates bounded signed URLs without revealing credentials', async () => {
    const storage = adapter();
    const upload = await storage.createUploadUrl({
      contentType: 'application/json',
      objectKey: 'tenant/incidents/incident/evidence/id',
      sha256: 'a'.repeat(64),
      sizeBytes: 128,
    });
    expect(upload.expiresInSeconds).toBe(300);
    expect(upload.url).toContain('X-Amz-Signature=');
    expect(upload.url).not.toContain('local-secret');
    expect(upload.headers).toMatchObject({ 'x-amz-meta-size': '128' });
    await expect(storage.createDownloadUrl('tenant/private/object')).resolves.toMatchObject({
      expiresInSeconds: 60,
    });
  });

  it('accepts an object only when metadata, size, hash, MIME and content match', async () => {
    const body = Buffer.from('{"event":"safe"}', 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            headers: {
              'content-type': 'application/json',
              'x-amz-meta-sha256': sha256,
              'x-amz-meta-size': String(body.byteLength),
            },
            status: 200,
          }),
      ),
    );
    await expect(
      adapter().inspect({
        contentType: 'application/json',
        objectKey: 'tenant/private/object',
        sha256,
        sizeBytes: body.byteLength,
      }),
    ).resolves.toEqual({ rejectionReason: null, safe: true });
  });

  it('keeps active or malicious content quarantined', async () => {
    const body = Buffer.from('<script>EICAR-STANDARD-ANTIVIRUS-TEST-FILE</script>', 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            headers: {
              'content-type': 'text/plain',
              'x-amz-meta-sha256': sha256,
              'x-amz-meta-size': String(body.byteLength),
            },
            status: 200,
          }),
      ),
    );
    await expect(
      adapter().inspect({
        contentType: 'text/plain',
        objectKey: 'tenant/private/object',
        sha256,
        sizeBytes: body.byteLength,
      }),
    ).resolves.toEqual({ rejectionReason: 'malware_or_active_content_detected', safe: false });
  });
});
