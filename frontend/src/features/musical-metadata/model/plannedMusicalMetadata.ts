// PREVIEW ONLY. Voice-type and instrument search is proposed in ADR-0007 and is
// NOT supported by the API yet: the contract has no such fields or filters, and
// no source data has been imported. These labels only illustrate the planned
// filters. When the API is extended, the options will come from
// GET /voice-types and GET /instruments instead of this file.

export const MUSICAL_METADATA = {
  available: false,
  reference: 'ADR-0007 (proposed)',
} as const;

export const PREVIEW_VOICE_TYPES: readonly string[] = [
  'Soprano',
  'Mezzo-soprano',
  'Contralto / Alto',
  'Tenor',
  'Baritone',
  'Bass',
  'Choir / mixed voices',
  'Unspecified voice',
];

export const PREVIEW_INSTRUMENTS: readonly string[] = [
  'Piano',
  'Violin',
  'Viola',
  'Cello',
  'Flute',
  'Guitar',
  'Organ',
  'Orchestra',
  'Voice and piano',
  'Chamber ensemble',
];
