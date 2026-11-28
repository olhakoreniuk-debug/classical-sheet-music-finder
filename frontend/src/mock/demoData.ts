// DEMONSTRATION DATA for the development-only mock API.
// It is NOT read from PostgreSQL. It is shaped exactly like the API responses in
// openapi.yaml (typed with the generated types) so the UI can be built and shown
// before the Express API exists.
//
// - The "imslp" works copy titles, composers and links of the 10 IMSLP works the
//   Week 1 importer stored; ids and timestamps here are illustrative.
// - The "openscore-lieder" works are illustrative entries (well-known songs; their
//   record ids are invented, not taken from the OpenScore dataset). They only show
//   how a second source appears; that source is not integrated yet.
// - The "manual" works illustrate works added through the form.
import type { Source, Work } from '../api/types';

const IMSLP_ATTRIBUTION = 'Data from IMSLP, the Petrucci Music Library (imslp.org).';
const LIEDER_ATTRIBUTION = 'OpenScore Lieder Corpus, released under CC0.';

export const demoSources: Source[] = [
  {
    code: 'manual',
    name: 'Added manually',
    kind: 'manual',
    homepageUrl: null,
    attribution: null,
    metadataLicence: null,
  },
  {
    code: 'imslp',
    name: 'IMSLP',
    kind: 'external',
    homepageUrl: 'https://imslp.org',
    attribution: IMSLP_ATTRIBUTION,
    metadataLicence: null,
  },
  {
    code: 'openscore-lieder',
    name: 'OpenScore Lieder',
    kind: 'external',
    homepageUrl: 'https://github.com/OpenScore/Lieder',
    attribution: LIEDER_ATTRIBUTION,
    metadataLicence: 'CC0-1.0',
  },
];

const imported = '2026-11-20T22:10:49Z';

function imslpWork(id: number, composerId: number, composer: string, title: string, catalogueNumber: string | null): Work {
  const permlink = `https://imslp.org/wiki/${`${title} (${composer})`.replace(/ /g, '_')}`;
  return {
    id,
    title,
    composer: { id: composerId, name: composer },
    catalogueNumber,
    pageUrl: encodeURI(permlink),
    source: { code: 'imslp', name: 'IMSLP' },
    sourceRecordId: permlink,
    attribution: IMSLP_ATTRIBUTION,
    createdAt: imported,
    updatedAt: imported,
  };
}

function liederWork(id: number, composerId: number, composer: string, title: string, catalogueNumber: string | null, recordId: string): Work {
  return {
    id,
    title,
    composer: { id: composerId, name: composer },
    catalogueNumber,
    pageUrl: null,
    source: { code: 'openscore-lieder', name: 'OpenScore Lieder' },
    sourceRecordId: recordId,
    attribution: LIEDER_ATTRIBUTION,
    createdAt: '2026-11-25T09:30:00Z',
    updatedAt: '2026-11-25T09:30:00Z',
  };
}

export const demoWorks: Work[] = [
  imslpWork(3, 4, 'Ferrari, Carlotta', '"A"', 'ICF 1237'),
  imslpWork(4, 5, 'Stankovych, Tatiana', '"Amicizia"', null),
  imslpWork(5, 6, 'Ladd, Gertrude I.', '"In Memoriam" A. Lincoln', 'IGL 1'),
  imslpWork(6, 7, 'Esnaola, Juan Pedro', '"Los ojos tiernos"', null),
  imslpWork(7, 8, 'Eisenbrey, Keith', '"Mrs. Ramsay rose. Lily rose."', 'IKE 24'),
  imslpWork(8, 9, 'West, Alfred H.', '"My Old Dutch" Waltz', null),
  imslpWork(9, 10, 'Hakobjanyan, Anna', '"Tagh of Awakening"', null),
  imslpWork(10, 11, 'Galuza, Artiom', '"Tambourin" by J. N. P. Royer - guitar transcription by Artiom Galuza', null),
  imslpWork(11, 12, 'Gonzaga, Thales', '"The Girl from the Bus Station"', null),
  imslpWork(12, 13, 'Hamilton, Jesse J.', '"Trip-O-Let" Dance', 'IJH 2'),
  liederWork(20, 20, 'Schubert, Franz', 'Gretchen am Spinnrade', 'D.118', 'Schubert,_Franz/_/Gretchen_am_Spinnrade'),
  liederWork(21, 21, 'Schumann, Clara', 'Liebst du um Schönheit', 'Op.12 No.4', 'Schumann,_Clara/_/Liebst_du_um_Schönheit'),
  liederWork(22, 22, 'Mendelssohn, Fanny', 'Nachtwanderer', 'Op.7 No.1', 'Hensel,_Fanny/_/Nachtwanderer'),
  liederWork(23, 23, 'Brahms, Johannes', 'Wiegenlied', 'Op.49 No.4', 'Brahms,_Johannes/_/Wiegenlied'),
  {
    id: 30,
    title: 'Untitled song in D minor',
    composer: null,
    catalogueNumber: null,
    pageUrl: null,
    source: { code: 'manual', name: 'Added manually' },
    sourceRecordId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    attribution: null,
    createdAt: '2026-11-26T14:05:00Z',
    updatedAt: '2026-11-26T14:05:00Z',
  },
];
