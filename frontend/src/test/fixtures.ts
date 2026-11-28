// Test fixtures typed with the generated API types: if openapi.yaml changes,
// fixtures that no longer match fail to compile.
import type { Source, Work } from '../api/types';

export const sourceA: Source = {
  code: 'source-a',
  name: 'Source A',
  kind: 'external',
  homepageUrl: 'https://a.example',
  attribution: 'Data from Source A.',
  metadataLicence: 'CC0-1.0',
};

export const manualSource: Source = {
  code: 'manual',
  name: 'Added manually',
  kind: 'manual',
  homepageUrl: null,
  attribution: null,
  metadataLicence: null,
};

export function makeWork(id: number, overrides: Partial<Work> = {}): Work {
  return {
    id,
    title: `Work ${id}`,
    composer: { id: 100 + id, name: `Composer ${id}` },
    catalogueNumber: `Op. ${id}`,
    pageUrl: `https://a.example/works/${id}`,
    source: { code: 'source-a', name: 'Source A' },
    sourceRecordId: `record-${id}`,
    attribution: 'Data from Source A.',
    createdAt: '2026-11-20T22:10:49Z',
    updatedAt: '2026-11-20T22:10:49Z',
    ...overrides,
  };
}
