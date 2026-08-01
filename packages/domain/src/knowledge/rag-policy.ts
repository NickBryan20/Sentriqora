export type KnowledgeTrustLevel = 'UNTRUSTED' | 'INTERNAL' | 'VERIFIED';

export interface KnowledgeChunkValue {
  content: string;
  ordinal: number;
  tokenEstimate: number;
}

export interface RetrievalEvidence {
  similarity: number;
  trustLevel: KnowledgeTrustLevel;
}

const TRUST_WEIGHT: Readonly<Record<KnowledgeTrustLevel, number>> = {
  INTERNAL: 0.9,
  UNTRUSTED: 0.55,
  VERIFIED: 1,
};

const SECRET_PATTERNS = [
  /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S+/giu,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/giu,
  /\bsk-[A-Za-z0-9_-]{12,}/gu,
] as const;

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions/giu,
  /system\s+prompt/giu,
  /reveal\s+(?:the\s+)?(?:secret|token|password)/giu,
  /(?:execute|run)\s+(?:this\s+)?(?:shell|sql|command)/giu,
] as const;

export class RagSecurityPolicy {
  readonly maximumChunks = 6;
  readonly minimumConfidence = 0.32;

  chunk(content: string, targetCharacters = 1_200, overlapCharacters = 180): KnowledgeChunkValue[] {
    const normalized = this.sanitizeContext(content).trim();
    if (normalized.length === 0) return [];
    const chunks: KnowledgeChunkValue[] = [];
    let start = 0;
    while (start < normalized.length && chunks.length < 200) {
      let end = Math.min(start + targetCharacters, normalized.length);
      if (end < normalized.length) {
        const boundary = normalized.lastIndexOf('\n', end);
        if (boundary > start + Math.floor(targetCharacters * 0.6)) end = boundary;
      }
      const value = normalized.slice(start, end).trim();
      if (value.length > 0) {
        chunks.push({
          content: value,
          ordinal: chunks.length,
          tokenEstimate: Math.ceil(value.length / 4),
        });
      }
      if (end >= normalized.length) break;
      start = Math.max(start + 1, end - overlapCharacters);
    }
    return chunks;
  }

  confidence(evidence: readonly RetrievalEvidence[]): number {
    if (evidence.length === 0) return 0;
    const scores = evidence
      .slice(0, this.maximumChunks)
      .map((item) => clamp(item.similarity) * TRUST_WEIGHT[item.trustLevel]);
    const weighted = scores.reduce((sum, score, index) => sum + score / (index + 1), 0);
    const normalizer = scores.reduce((sum, _score, index) => sum + 1 / (index + 1), 0);
    return Number((weighted / normalizer).toFixed(4));
  }

  shouldAbstain(evidence: readonly RetrievalEvidence[]): boolean {
    return evidence.length === 0 || this.confidence(evidence) < this.minimumConfidence;
  }

  sanitizeContext(value: string): string {
    let sanitized = removeControlCharacters(value.normalize('NFKC'));
    for (const pattern of SECRET_PATTERNS) sanitized = sanitized.replace(pattern, '[REDACTED]');
    for (const pattern of INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[UNTRUSTED_INSTRUCTION_REMOVED]');
    }
    return sanitized.replace(/[ \t]+/gu, ' ').replace(/\n{3,}/gu, '\n\n');
  }
}

function removeControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return (code >= 0 && code <= 8) ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
        ? ' '
        : character;
    })
    .join('');
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
