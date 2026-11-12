/**
 * The ledger: what the Shadow did on the street, kept on the save next to the reply-choice state (vossTrust,
 * haleTemper). Going Home and The Station fill it; the city, the news, the newspaper and Voss's morning call read it.
 * Bands are documented in docs/story/ledger.md.
 */
export type Ledger = {
  /** Bystanders the Shadow killed (pedestrians, shopkeepers, the receptionist; not police, hostiles or the lesson's guards). */
  kills: number;
  /** Links made with Possess. */
  possessions: number;
  /** Possessed bodies consumed. */
  consumes: number;
  /** Bystanders who saw a kill and ran. */
  witnesses: number;
  /** Times the story reported it: a news report heard, a Voss line that knows. */
  reported: number;
};

/** 0 no one hurt, 1 injuries, 2 deaths. */
export type LedgerBand = 0 | 1 | 2;

/** Kills at which the city answers: sirens, a police car, a nervous crowd, an officer at the station gate. */
export const SIREN_KILLS = 2;
/** Seconds between the kill that crosses SIREN_KILLS and the car arriving. */
export const SIREN_WITHIN = 18;

export const emptyLedger = (): Ledger => ({ kills: 0, possessions: 0, consumes: 0, witnesses: 0, reported: 0 });

const count = (value: unknown) => Math.max(0, Math.min(99, Math.round(Number(value) || 0)));

export const clampLedger = (raw: unknown): Ledger => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Ledger, unknown>>;
  return {
    kills: count(r.kills),
    possessions: count(r.possessions),
    consumes: count(r.consumes),
    witnesses: count(r.witnesses),
    reported: count(r.reported),
  };
};

export const ledgerBand = (ledger: Ledger): LedgerBand => {
  if (ledger.kills >= SIREN_KILLS) return 2;
  if (ledger.kills > 0) return 1;
  return 0;
};

/** What the story code gets: read the ledger, add to it. */
export type LedgerApi = {
  get: () => Ledger;
  add: (kind: keyof Ledger, amount?: number) => Ledger;
  reset: () => Ledger;
};

/** The news clip for a deaths report: two, three, four, or five and more. */
export const deathsBucket = (kills: number) => Math.max(2, Math.min(5, kills));

/** Sirens on the avenue and over the station once the ledger crosses SIREN_KILLS (Hawkes Gen take; a car pass plays until it exists). */
export const SIREN_SFX = '/assets/audio/sfx/street/siren-police.mp3';
