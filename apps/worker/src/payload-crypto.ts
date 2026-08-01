import { createDecipheriv } from 'node:crypto';

export interface EncryptedPayload {
  authTag: string;
  ciphertext: string;
  iv: string;
}

export class PayloadCrypto {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    this.key = Buffer.from(encodedKey, 'base64');
    if (this.key.byteLength !== 32) {
      throw new Error('AUTH_ENCRYPTION_KEY must decode to 32 bytes');
    }
  }

  decrypt(value: EncryptedPayload): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(value.authTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
