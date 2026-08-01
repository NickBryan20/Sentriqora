export const EVIDENCE_STORAGE_PORT = Symbol('EVIDENCE_STORAGE_PORT');

export interface EvidenceInspection {
  rejectionReason: string | null;
  safe: boolean;
}

export interface EvidenceStoragePort {
  createDownloadUrl(objectKey: string): Promise<{ expiresInSeconds: number; url: string }>;
  createUploadUrl(input: {
    contentType: string;
    objectKey: string;
    sha256: string;
    sizeBytes: number;
  }): Promise<{
    expiresInSeconds: number;
    headers: Readonly<Record<string, string>>;
    url: string;
  }>;
  inspect(input: {
    contentType: string;
    objectKey: string;
    sha256: string;
    sizeBytes: number;
  }): Promise<EvidenceInspection>;
}
