import type { Work } from '../../../api/types';

/** Labels for nullable fields, so "no value" is always shown explicitly. */
export const composerLabel = (work: Work): string => work.composer?.name ?? 'Unknown composer';
export const catalogueLabel = (work: Work): string => work.catalogueNumber ?? 'No catalogue number';
