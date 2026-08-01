import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'node:crypto';

import type { Environment } from '../../configuration';
import type { KnowledgeStoragePort } from '../application/ports/knowledge-storage.port';

const REGION = 'us-east-1';
const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

@Injectable()
export class MinioKnowledgeStorageAdapter implements KnowledgeStoragePort {
  private readonly accessKey: string;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly secretKey: string;

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    this.accessKey = config.get('MINIO_ACCESS_KEY', { infer: true });
    this.bucket = config.get('MINIO_BUCKET_KNOWLEDGE', { infer: true });
    this.endpoint = config.get('MINIO_ENDPOINT', { infer: true });
    this.secretKey = config.get('MINIO_SECRET_KEY', { infer: true });
  }

  async put(input: {
    content: string;
    contentType: string;
    objectKey: string;
    sha256: string;
  }): Promise<void> {
    const headers = { 'content-type': input.contentType, 'x-amz-meta-sha256': input.sha256 };
    const response = await fetch(this.presign('PUT', input.objectKey, headers), {
      body: input.content,
      headers,
      method: 'PUT',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error('KnowledgeObjectWriteFailed');
  }

  async delete(objectKeys: readonly string[]): Promise<void> {
    await Promise.all(
      objectKeys.map(async (objectKey) => {
        const response = await fetch(this.presign('DELETE', objectKey, {}), {
          method: 'DELETE',
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok && response.status !== 404) throw new Error('KnowledgeObjectDeleteFailed');
      }),
    );
  }

  private presign(
    method: 'DELETE' | 'PUT',
    objectKey: string,
    signedHeaders: Readonly<Record<string, string>>,
  ): string {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replaceAll('-', '');
    const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replaceAll(':', '')}Z`;
    const endpoint = new URL(this.endpoint);
    const canonicalPath = `/${encode(this.bucket)}/${objectKey.split('/').map(encode).join('/')}`;
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
      ['X-Amz-Expires', '60'],
      ['X-Amz-SignedHeaders', signedHeaderNames],
    ]);
    const canonicalQuery = queryString(query);
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
    endpoint.search = queryString(query);
    return endpoint.toString();
  }
}

function signingKey(secret: string, dateStamp: string): Buffer {
  const date = createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest();
  const region = createHmac('sha256', date).update(REGION).digest();
  const service = createHmac('sha256', region).update(SERVICE).digest();
  return createHmac('sha256', service).update('aws4_request').digest();
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function queryString(query: ReadonlyMap<string, string>): string {
  return [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&');
}
