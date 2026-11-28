// Readable aliases for the types generated from openapi.yaml.
// Never declare API shapes by hand: change openapi.yaml and run `npm run api:types`.
import type { components, operations } from './generated/schema';

type Schemas = components['schemas'];

export type Work = Schemas['Work'];
export type WorkPage = Schemas['WorkPage'];
export type Composer = Schemas['Composer'];
export type Source = Schemas['Source'];
export type SourceReference = Schemas['SourceReference'];
export type SourceList = Schemas['SourceList'];
export type CreateWorkRequest = Schemas['CreateWorkRequest'];
export type Problem = Schemas['Problem'];
export type FieldError = Schemas['FieldError'];

export type ListWorksQuery = NonNullable<operations['listWorks']['parameters']['query']>;
export type WorkSort = NonNullable<ListWorksQuery['sort']>;
