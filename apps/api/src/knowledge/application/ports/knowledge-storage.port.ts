export const KNOWLEDGE_STORAGE_PORT = Symbol('KNOWLEDGE_STORAGE_PORT');

export interface KnowledgeStoragePort {
  delete(objectKeys: readonly string[]): Promise<void>;
  put(input: {
    content: string;
    contentType: string;
    objectKey: string;
    sha256: string;
  }): Promise<void>;
}
