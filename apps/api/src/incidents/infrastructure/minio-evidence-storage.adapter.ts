import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { Environment } from '../../configuration';
import type {
  EvidenceInspection,
  EvidenceStoragePort,
} from '../application/ports/evidence-storage.port';

const REGION = 'us-east-1';
const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

@Injectable()
export class MinioEvidenceStorageAdapter implements EvidenceStoragePort {
  private readonly accessKey: string;
  private readonly bucket: string;
  private readonly internalEndpoint: string;
  private readonly publicEndpoint: string;
  private readonly secretKey: string;

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    this.accessKey = config.get('MINIO_ACCESS_KEY', { infer: true });
    this.bucket = config.get('MINIO_BUCKET_EVIDENCE', { infer: true });
    this.internalEndpoint = config.get('MINIO_ENDPOINT', { infer: true });
    this.publicEndpoint = config.get('MINIO_PUBLIC_ENDPOINT', { infer: true });
    this.secretKey = config.get('MINIO_SECRET_KEY', { infer: true });
  }

  createDownloadUrl(objectKey: string): Promise<{ expiresInSeconds: number; url: string }> {
    const expiresInSeconds = 60;
    return Promise.resolve({
      expiresInSeconds,
      url: this.presign('GET', objectKey, expiresInSeconds, {}, this.publicEndpoint),
    });
  }

  createUploadUrl(input: {
    contentType: string;
    objectKey: string;
    sha256: string;
    sizeBytes: number;
  }): Promise<{
    expiresInSeconds: number;
    headers: Readonly<Record<string, string>>;
    url: string;
  }> {
    const expiresInSeconds = 300;
    const headers = {
      'content-type': input.contentType,
      'x-amz-meta-sha256': input.sha256,
      'x-amz-meta-size': String(input.sizeBytes),
    };
    return Promise.resolve({
      expiresInSeconds,
      headers,
      url: this.presign('PUT', input.objectKey, expiresInSeconds, headers, this.publicEndpoint),
    });
  }

  async inspect(input: {
    contentType: string;
    objectKey: string;
    sha256: string;
    sizeBytes: number;
  }): Promise<EvidenceInspection> {
    const response = await fetch(
      this.presign('GET', input.objectKey, 30, {}, this.internalEndpoint),
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!response.ok) throw new Error('EvidenceObjectUnavailable');
    const declaredHash = response.headers.get('x-amz-meta-sha256');
    const declaredSize = response.headers.get('x-amz-meta-size');
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
    if (
      declaredHash !== input.sha256 ||
      declaredSize !== String(input.sizeBytes) ||
      contentType !== input.contentType
    ) {
      return { rejectionReason: 'object_metadata_mismatch', safe: false };
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength !== input.sizeBytes) {
      return { rejectionReason: 'object_size_mismatch', safe: false };
    }
    const actualHash = createHash('sha256').update(body).digest('hex');
    if (!timingSafeTextEqual(actualHash, input.sha256)) {
      return { rejectionReason: 'object_hash_mismatch', safe: false };
    }
    const rejectionReason = scan(body, input.contentType);
    return { rejectionReason, safe: rejectionReason === null };
  }

  private presign(
    method: 'GET' | 'PUT',
    objectKey: string,
    expiresInSeconds: number,
    signedHeaders: Readonly<Record<string, string>>,
    endpointValue: string,
  ): string {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replaceAll('-', '');
    const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replaceAll(':', '')}Z`;
    const endpoint = new URL(endpointValue);
    const canonicalPath = `/${encodePath(this.bucket)}/${objectKey
      .split('/')
      .map(encodePath)
      .join('/')}`;
    const headers: Record<string, string> = {
      host: endpoint.host,
      ...Object.fromEntries(
        Object.entries(signedHeaders).map(([key, value]) => [key.toLowerCase(), value.trim()]),
      ),
    };
    const headerNames = Object.keys(headers).sort();
    const signedHeaderNames = headerNames.join(';');
    const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
    const query = new Map<string, string>([
      ['X-Amz-Algorithm', ALGORITHM],
      ['X-Amz-Credential', `${this.accessKey}/${credentialScope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(expiresInSeconds)],
      ['X-Amz-SignedHeaders', signedHeaderNames],
    ]);
    const canonicalQuery = [...query.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${encodeQuery(key)}=${encodeQuery(value)}`)
      .join('&');
    const canonicalHeaders = headerNames.map((name) => `${name}:${headers[name]}\n`).join('');
    const canonicalRequest = [
      method,
      canonicalPath,
      canonicalQuery,
      canonicalHeaders,
      signedHeaderNames,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      ALGORITHM,
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const signature = createHmac('sha256', signingKey(this.secretKey, dateStamp))
      .update(stringToSign)
      .digest('hex');
    query.set('X-Amz-Signature', signature);
    endpoint.pathname = canonicalPath;
    endpoint.search = [...query.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${encodeQuery(key)}=${encodeQuery(value)}`)
      .join('&');
    return endpoint.toString();
  }
}

function signingKey(secret: string, dateStamp: string): Buffer {
  const date = createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest();
  const region = createHmac('sha256', date).update(REGION).digest();
  const service = createHmac('sha256', region).update(SERVICE).digest();
  return createHmac('sha256', service).update('aws4_request').digest();
}

function encodePath(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeQuery(value: string): string {
  return encodePath(value).replace(/%7E/gu, '~');
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function scan(body: Buffer, contentType: string): string | null {
  if (
    (body[0] === 0x4d && body[1] === 0x5a) ||
    (body[0] === 0x7f && body.subarray(1, 4).toString('ascii') === 'ELF') ||
    body.subarray(0, 2).toString('ascii') === '#!'
  ) {
    return 'executable_content_forbidden';
  }
  const preview = body.subarray(0, Math.min(body.byteLength, 1_048_576)).toString('utf8');
  if (
    preview.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ||
    /<script|<svg|<!doctype\s+html|\/JavaScript|\/Launch/iu.test(preview)
  ) {
    return 'malware_or_active_content_detected';
  }
  if (contentType === 'application/pdf' && body.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return 'content_signature_mismatch';
  }
  if (
    contentType === 'image/png' &&
    !body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'content_signature_mismatch';
  }
  if (contentType === 'image/jpeg' && !(body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)) {
    return 'content_signature_mismatch';
  }
  if (contentType === 'application/json') {
    try {
      const parsed: unknown = JSON.parse(body.toString('utf8'));
      if (typeof parsed !== 'object' || parsed === null) return 'content_signature_mismatch';
    } catch {
      return 'content_signature_mismatch';
    }
  }
  if ((contentType === 'text/plain' || contentType === 'text/csv') && body.includes(0)) {
    return 'binary_content_forbidden';
  }
  return null;
}
