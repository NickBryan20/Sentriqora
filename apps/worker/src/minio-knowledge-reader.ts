import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const REGION = 'us-east-1';
const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

export class MinioKnowledgeReader {
  constructor(
    private readonly endpoint: string,
    private readonly bucket: string,
    private readonly accessKey: string,
    private readonly secretKey: string,
  ) {}

  async read(input: { objectKey: string; sha256: string; sizeBytes: number }): Promise<string> {
    const response = await fetch(this.presign(input.objectKey), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`KnowledgeObjectHttp${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    const actualHash = createHash('sha256').update(body).digest('hex');
    const declaredHash = response.headers.get('x-amz-meta-sha256');
    if (
      body.byteLength !== input.sizeBytes ||
      declaredHash !== input.sha256 ||
      !safeEqual(actualHash, input.sha256)
    ) {
      throw new Error('KnowledgeObjectIntegrityMismatch');
    }
    if (body.includes(0)) throw new Error('KnowledgeObjectBinaryContent');
    return body.toString('utf8');
  }

  private presign(objectKey: string): string {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replaceAll('-', '');
    const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replaceAll(':', '')}Z`;
    const endpoint = new URL(this.endpoint);
    const canonicalPath = `/${encode(this.bucket)}/${objectKey.split('/').map(encode).join('/')}`;
    const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
    const query = new Map<string, string>([
      ['X-Amz-Algorithm', ALGORITHM],
      ['X-Amz-Credential', `${this.accessKey}/${credentialScope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', '60'],
      ['X-Amz-SignedHeaders', 'host'],
    ]);
    const canonicalQuery = queryString(query);
    const canonicalRequest = [
      'GET',
      canonicalPath,
      canonicalQuery,
      `host:${endpoint.host}\n`,
      'host',
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

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer)
  );
}
