// Organizer journey for one tournament: 7 stages derived from real state (never stored). The first unfinished stage is "now".
export type StageKey = 'setup' | 'rules' | 'publish' | 'entries' | 'fixtures' | 'play' | 'finish';
export type StageStatus = 'done' | 'now' | 'later';
export interface Stage { key: StageKey; label: string; status: StageStatus; detail: string; cta: { label: string; to: string } }
export interface JourneyInput {
  setupIssues: { label: string; step: number }[]; // publish checklist items that fail, excluding rules
  rulesPublished: boolean; published: boolean; archived: boolean; finished: boolean;
  regOpensAt: string; regClosesAt: string; now: number;
  entries: { confirmed: number; pending: number; capacity: number };
  categories: number; categoriesWithPublishedFixtures: number;
  matches: { total: number; finished: number; unverified: number };
}

export function journey(i: JourneyInput): Stage[] {
  const closed = i.now > Date.parse(i.regClosesAt), fixturesDone = i.categories > 0 && i.categoriesWithPublishedFixtures === i.categories;
  const playDone = fixturesDone && i.matches.total > 0 && i.matches.finished === i.matches.total && i.matches.unverified === 0;
  const raw: [StageKey, string, boolean, string, { label: string; to: string }][] = [
    ['setup', 'Set up the tournament', !i.setupIssues.length, i.setupIssues.length ? `To do: ${i.setupIssues.map(x => x.label.toLowerCase()).join('; ')}` : 'Basics, categories, format, scoring, registration and courts are set.', { label: 'Continue setup', to: `setup?step=${i.setupIssues[0]?.step ?? 1}` }],
    ['rules', 'Write and publish the rules', i.rulesPublished, i.rulesPublished ? 'Players accept this version when they register.' : 'Entrants must accept a published version before they can register.', { label: 'Write rules', to: 'rules' }],
    ['publish', 'Publish and open entries', i.published || i.archived, i.published ? `Entries ${closed ? 'closed' : 'open'} until ${i.regClosesAt.slice(0, 10)}.` : 'Makes the public page live. Registration opens on the date you set.', { label: 'Review & publish', to: 'setup?step=8' }],
    ['entries', 'Confirm entries', (i.published || i.archived) && (fixturesDone || (closed && i.entries.pending === 0)), `${i.entries.confirmed} of ${i.entries.capacity} places confirmed${i.entries.pending ? ` · ${i.entries.pending} waiting on payment` : ''}${closed ? '' : ' · registration still open'}.`, { label: 'Review entries', to: 'registrations' }],
    ['fixtures', 'Generate and publish fixtures', fixturesDone, `${i.categoriesWithPublishedFixtures} of ${i.categories} categor${i.categories === 1 ? 'y' : 'ies'} published.`, { label: 'Open fixtures', to: 'fixtures' }],
    ['play', 'Play and verify matches', playDone, `${i.matches.finished} of ${i.matches.total} matches played${i.matches.unverified ? ` · ${i.matches.unverified} to verify` : ''}.`, { label: 'Open matches', to: 'matches' }],
    ['finish', 'Finish the tournament', i.finished, i.finished ? (i.archived ? 'Results published and archived.' : 'Results published. Archive it when you are ready.') : 'Publishes final results and winners, and messages every entrant.', { label: 'Finish tournament', to: 'finish' }],
  ];
  let nowSet = false;
  return raw.map(([key, label, done, detail, cta]) => {
    const status: StageStatus = done ? 'done' : nowSet ? 'later' : ((nowSet = true), 'now');
    return { key, label, status, detail, cta };
  });
}
