// Route paths in one place, shared by routes and links (no import cycles).
export const paths = {
  home: '/',
  catalogue: '/works',
  newWork: '/works/new',
  work: (workId: number) => `/works/${workId}`,
} as const;
