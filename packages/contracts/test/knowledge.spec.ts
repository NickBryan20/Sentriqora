import { describe, expect, it } from 'vitest';

import {
  createKnowledgeDocumentSchema,
  recommendationOutputSchema,
  requestRecommendationSchema,
} from '../src';

describe('knowledge contracts', () => {
  it('accepts a bounded text document and rejects unknown properties', () => {
    expect(
      createKnowledgeDocumentSchema.parse({
        content: 'Rotate the exposed credential and revoke every active session immediately.',
        contentType: 'text/plain',
        sourceType: 'RUNBOOK',
        title: 'Credential exposure response',
        trustLevel: 'VERIFIED',
      }).title,
    ).toBe('Credential exposure response');
    expect(() =>
      createKnowledgeDocumentSchema.parse({
        content: 'x'.repeat(50),
        contentType: 'text/plain',
        sourceType: 'RUNBOOK',
        title: 'Unsafe',
        trustLevel: 'VERIFIED',
        execute: true,
      }),
    ).toThrow();
  });

  it('validates recommendation output and bounded citations', () => {
    expect(
      recommendationOutputSchema.parse({
        answer: 'Revoke the credential [src-1].',
        citationIds: ['src-1'],
        confidence: 0.82,
        recommendedActions: ['Revoke the exposed credential.'],
        shouldAbstain: false,
      }).confidence,
    ).toBe(0.82);
    expect(() => requestRecommendationSchema.parse({ question: 'short' })).toThrow();
  });
});
