import type { AuthPrincipal } from '@aegisflow/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { argon2id, hash as argonHash, verify as argonVerify } from 'argon2';
import { z } from 'zod';

import type { Environment } from '../../configuration';
import type {
  EncryptedValue,
  IdentitySecurityPort,
  IssuedOpaqueToken,
  RecoveryCodeSet,
} from '../application/ports/identity-security.port';

const jwtPayloadSchema = z.object({
  aud: z.string(),
  exp: z.number().int(),
  iat: z.number().int(),
  iss: z.string(),
  jti: z.uuid(),
  mfa: z.boolean(),
  nbf: z.number().int(),
  org: z.uuid(),
  permissions: z.array(z.string().min(3).max(100)).max(100),
  sid: z.uuid(),
  sub: z.uuid(),
});

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

@Injectable()
export class NodeIdentitySecurityAdapter implements IdentitySecurityPort {
  private readonly audience: string;
  private readonly encryptionKey: Buffer;
  private readonly issuer: string;
  private readonly jwtSecret: Buffer;
  private readonly pepper: Buffer;
  private readonly tokenTtlSeconds: number;

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    this.audience = config.get('AUTH_AUDIENCE', { infer: true });
    this.encryptionKey = Buffer.from(
      String(config.get('AUTH_ENCRYPTION_KEY', { infer: true })),
      'base64',
    );
    this.issuer = config.get('AUTH_ISSUER', { infer: true });
    this.jwtSecret = Buffer.from(String(config.get('AUTH_JWT_SECRET', { infer: true })), 'utf8');
    this.pepper = Buffer.from(String(config.get('AUTH_TOKEN_PEPPER', { infer: true })), 'utf8');
    this.tokenTtlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  }

  async hashPassword(password: string): Promise<string> {
    return argonHash(password, {
      hashLength: 32,
      memoryCost: 19_456,
      parallelism: 1,
      timeCost: 2,
      type: argon2id,
    });
  }

  async verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await argonVerify(passwordHash, password);
    } catch {
      return false;
    }
  }

  generateId(): string {
    return randomUUID();
  }

  generateOpaqueToken(): IssuedOpaqueToken {
    const plainText = randomBytes(32).toString('base64url');
    return { hash: this.hashOpaqueToken(plainText), plainText };
  }

  hashOpaqueToken(value: string): string {
    return createHmac('sha256', this.pepper).update(value, 'utf8').digest('hex');
  }

  hashFingerprint(value: string): string {
    return this.hashOpaqueToken(value.trim().toLocaleLowerCase('en-US'));
  }

  encrypt(value: string): EncryptedValue {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      authTag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      iv: iv.toString('base64url'),
    };
  }

  decrypt(value: EncryptedValue): string {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(value.iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(value.authTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  generateTotpSecret(): string {
    return encodeBase32(randomBytes(20));
  }

  verifyTotp(secret: string, code: string, now: Date): bigint | null {
    const currentCounter = BigInt(Math.floor(now.getTime() / 30_000));
    for (const offset of [-1n, 0n, 1n]) {
      const counter = currentCounter + offset;
      if (counter >= 0n && safeEqual(totpCode(secret, counter), code)) {
        return counter;
      }
    }
    return null;
  }

  generateRecoveryCodes(count: number): RecoveryCodeSet {
    const plainTextCodes: string[] = [];
    const hashes: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const normalized = encodeBase32(randomBytes(10));
      plainTextCodes.push(normalized.match(/.{1,4}/gu)?.join('-') ?? normalized);
      hashes.push(this.hashOpaqueToken(normalized));
    }
    return { hashes, plainTextCodes };
  }

  issueAccessToken(principal: AuthPrincipal): string {
    const now = Math.floor(Date.now() / 1_000);
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const payload = encodeJson({
      aud: this.audience,
      exp: now + this.tokenTtlSeconds,
      iat: now,
      iss: this.issuer,
      jti: randomUUID(),
      mfa: principal.mfaVerified,
      nbf: now - 1,
      org: principal.organizationId,
      permissions: principal.permissions,
      sid: principal.sessionId,
      sub: principal.userId,
    });
    const signingInput = `${header}.${payload}`;
    const signature = createHmac('sha256', this.jwtSecret).update(signingInput).digest('base64url');
    return `${signingInput}.${signature}`;
  }

  verifyAccessToken(token: string): AuthPrincipal {
    if (token.length > 8_192) {
      throw new Error('Invalid access token');
    }
    const segments = token.split('.');
    if (segments.length !== 3) {
      throw new Error('Invalid access token');
    }
    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    if (
      encodedHeader === undefined ||
      encodedPayload === undefined ||
      encodedSignature === undefined
    ) {
      throw new Error('Invalid access token');
    }
    const header = parseJson(encodedHeader);
    if (
      typeof header !== 'object' ||
      header === null ||
      !('alg' in header) ||
      header.alg !== 'HS256' ||
      !('typ' in header) ||
      header.typ !== 'JWT'
    ) {
      throw new Error('Invalid access token');
    }
    const expected = createHmac('sha256', this.jwtSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const actual = Buffer.from(encodedSignature, 'base64url');
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
      throw new Error('Invalid access token');
    }

    const payload = jwtPayloadSchema.parse(parseJson(encodedPayload));
    const now = Math.floor(Date.now() / 1_000);
    if (
      payload.iss !== this.issuer ||
      payload.aud !== this.audience ||
      payload.exp <= now ||
      payload.nbf > now + 5 ||
      payload.iat > now + 5 ||
      payload.exp - payload.iat > this.tokenTtlSeconds + 5
    ) {
      throw new Error('Invalid access token');
    }

    return {
      mfaVerified: payload.mfa,
      organizationId: payload.org,
      permissions: payload.permissions,
      sessionId: payload.sid,
      userId: payload.sub,
    };
  }
}

function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseJson(encoded: string): unknown {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return (
    leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function encodeBase32(value: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let output = '';
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(accumulator >>> bits) & 31] ?? '';
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31] ?? '';
  }
  return output;
}

function decodeBase32(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value.replaceAll('=', '').toLocaleUpperCase('en-US')) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new Error('Invalid base32 value');
    }
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, counter: bigint): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = (digest.at(-1) ?? 0) & 15;
  const binary = (digest.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000;
  return binary.toString().padStart(6, '0');
}
