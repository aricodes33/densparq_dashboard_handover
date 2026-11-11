// Event-sourced scoring. state = reduce(non-voided events). The server stores ScoreEvents append-only
// and recomputes with the same reducers (docs/business-rules.md §5). Undo = void the last event.
import type { ScoreEvent, ScoringConfig, Sport } from './types';

export type Side = 'home' | 'away';
export interface Summary { home: number; away: number; detail: string; winner?: Side; isDraw: boolean; finished: boolean; headline: string }

// ---- Rally: badminton / pickleball ----
export interface RallyState { games: { home: number; away: number; winner?: Side }[]; server: Side; gamesWon: Record<Side, number>; winner?: Side }
export function rally(evts: ScoreEvent[], cfg: ScoringConfig): RallyState {
  const p = cfg.rally ?? { pointsToWin: 21, cap: 30, bestOf: 3 };
  const s: RallyState = { games: [{ home: 0, away: 0 }], server: 'home', gamesWon: { home: 0, away: 0 } };
  for (const e of evts) {
    if (e.type !== 'point' || s.winner) continue;
    const side = e.payload.side as Side, g = s.games[s.games.length - 1];
    g[side]++; s.server = side;
    const o = side === 'home' ? 'away' : 'home';
    if ((g[side] >= p.pointsToWin && g[side] - g[o] >= 2) || g[side] >= p.cap) {
      g.winner = side; s.gamesWon[side]++;
      if (s.gamesWon[side] > p.bestOf / 2) s.winner = side; else s.games.push({ home: 0, away: 0 });
    }
  }
  return s;
}

// ---- Football ----
export type FPeriod = 'pre' | 'H1' | 'HT' | 'H2' | 'FT' | 'ET1' | 'ET2' | 'PEN' | 'END';
export interface FootballState { period: FPeriod; goals: Record<Side, number>; scorers: { side: Side; player?: string; minute: number }[]; cards: { side: Side; color: 'yellow' | 'red'; player?: string; minute: number }[]; pens: Record<Side, boolean[]>; clockRunningSince?: number; elapsedMs: number }
export function football(evts: ScoreEvent[]): FootballState {
  const s: FootballState = { period: 'pre', goals: { home: 0, away: 0 }, scorers: [], cards: [], pens: { home: [], away: [] }, elapsedMs: 0 };
  for (const e of evts) {
    const t = Date.parse(e.at), side = e.payload.side as Side, minute = Number(e.payload.minute ?? 0);
    if (e.type === 'period') {
      if (s.clockRunningSince != null) { s.elapsedMs += t - s.clockRunningSince; s.clockRunningSince = undefined; }
      s.period = e.payload.period as FPeriod;
      if (['H1', 'H2', 'ET1', 'ET2'].includes(s.period)) { s.clockRunningSince = t; if (s.period === 'H2' || s.period === 'ET1') s.elapsedMs = s.elapsedMs; }
    } else if (e.type === 'clock') {
      if (e.payload.run && s.clockRunningSince == null) s.clockRunningSince = t;
      if (!e.payload.run && s.clockRunningSince != null) { s.elapsedMs += t - s.clockRunningSince; s.clockRunningSince = undefined; }
    } else if (e.type === 'goal') { s.goals[side]++; s.scorers.push({ side, player: e.payload.player as string | undefined, minute }); }
    else if (e.type === 'card') s.cards.push({ side, color: e.payload.color as 'yellow' | 'red', player: e.payload.player as string | undefined, minute });
    else if (e.type === 'pen') s.pens[side].push(Boolean(e.payload.scored));
  }
  return s;
}

// ---- Box cricket ----
export interface Innings { batting: Side; runs: number; wickets: number; legalBalls: number; extras: number; balls: string[] }
export interface CricketState { innings: Innings[]; target?: number; winner?: Side; isTie: boolean; done: boolean }
export function cricket(evts: ScoreEvent[], cfg: ScoringConfig): CricketState {
  const p = cfg.cricket ?? { overs: 6, ballsPerOver: 6, playersPerSide: 6 };
  const first = (evts.find(e => e.type === 'toss')?.payload.batting as Side) ?? 'home';
  const s: CricketState = { innings: [{ batting: first, runs: 0, wickets: 0, legalBalls: 0, extras: 0, balls: [] }], isTie: false, done: false };
  const close = () => {
    if (s.innings.length === 1) { s.target = s.innings[0].runs + 1; s.innings.push({ batting: first === 'home' ? 'away' : 'home', runs: 0, wickets: 0, legalBalls: 0, extras: 0, balls: [] }); }
    else finish();
  };
  const finish = () => {
    const [a, b] = s.innings; s.done = true;
    if (a.runs === b.runs) s.isTie = true; else s.winner = a.runs > b.runs ? a.batting : b.batting;
  };
  for (const e of evts) {
    if (s.done) break;
    const inn = s.innings[s.innings.length - 1];
    if (e.type === 'toss') continue;
    if (e.type === 'innings_end') { close(); continue; }
    if (e.type !== 'ball') continue;
    const runs = Number(e.payload.runs ?? 0), extra = e.payload.extra as string | undefined, wicket = Boolean(e.payload.wicket);
    const extraRun = extra === 'wd' || extra === 'nb' ? 1 : 0;
    inn.runs += runs + extraRun; inn.extras += extraRun + (extra === 'b' || extra === 'lb' ? runs : 0);
    if (!extra || extra === 'b' || extra === 'lb') inn.legalBalls++;
    if (wicket) inn.wickets++;
    inn.balls.push(wicket ? 'W' : extra ? `${runs + extraRun}${extra}` : String(runs));
    const allOut = inn.wickets >= p.playersPerSide - 1, oversDone = inn.legalBalls >= p.overs * p.ballsPerOver;
    if (s.innings.length === 2 && s.target && inn.runs >= s.target) { finish(); continue; }
    if (allOut || oversDone) close();
  }
  return s;
}
export const overs = (legal: number, bpo = 6) => `${Math.floor(legal / bpo)}.${legal % bpo}`;

// ---- Ultimate frisbee ----
export interface FrisbeeState { score: Record<Side, number>; half: 1 | 2; timeouts: Record<Side, number>; spirit?: Record<Side, number>; winner?: Side; capped: boolean; log: Side[] }
export function frisbee(evts: ScoreEvent[], cfg: ScoringConfig): FrisbeeState {
  const p = cfg.frisbee ?? { pointsToWin: 15, cap: 17, halftimeAt: 8, timeoutsPerHalf: 2, spiritScoring: true };
  const s: FrisbeeState = { score: { home: 0, away: 0 }, half: 1, timeouts: { home: 0, away: 0 }, capped: false, log: [] };
  for (const e of evts) {
    const side = e.payload.side as Side;
    if (e.type === 'point' && !s.winner) {
      s.score[side]++; s.log.push(side);
      if (s.half === 1 && s.score[side] >= p.halftimeAt) { s.half = 2; s.timeouts = { home: 0, away: 0 }; }
      const o = side === 'home' ? 'away' : 'home';
      if ((s.score[side] >= p.pointsToWin && s.score[side] - s.score[o] >= 2) || s.score[side] >= p.cap) { s.winner = side; s.capped = s.score[side] >= p.cap; }
    } else if (e.type === 'timeout') s.timeouts[side]++;
    else if (e.type === 'cap') { s.capped = true; if (s.score.home !== s.score.away) s.winner = s.score.home > s.score.away ? 'home' : 'away'; }
    else if (e.type === 'spirit') s.spirit = { home: Number(e.payload.home), away: Number(e.payload.away) };
  }
  return s;
}

// ---- DSL Lagori: configurable rounds + labelled actions (organizer defines points in ScoringConfig.lagori) ----
export interface LagoriState { round: number; inRound: boolean; score: Record<Side, number>; perRound: Record<Side, number>[]; log: { side: Side; label: string; points: number; round: number }[]; done: boolean; roundStartedAt?: number }
export function lagori(evts: ScoreEvent[], cfg: ScoringConfig): LagoriState {
  const p = cfg.lagori ?? { rounds: 3, roundSeconds: 180, actions: [] };
  const s: LagoriState = { round: 0, inRound: false, score: { home: 0, away: 0 }, perRound: [], log: [], done: false };
  for (const e of evts) {
    if (e.type === 'round_start' && !s.done) { s.round++; s.inRound = true; s.perRound.push({ home: 0, away: 0 }); s.roundStartedAt = Date.parse(e.at); }
    else if (e.type === 'round_end') { s.inRound = false; if (s.round >= p.rounds) s.done = true; }
    else if (e.type === 'action' && s.inRound) {
      const a = p.actions.find(x => x.key === e.payload.key); if (!a) continue;
      const actor = e.payload.side as Side, to: Side = a.side === 'self' ? actor : actor === 'home' ? 'away' : 'home';
      s.score[to] += a.points; s.perRound[s.round - 1][to] += a.points; s.log.push({ side: actor, label: a.label, points: a.points, round: s.round });
    }
  }
  return s;
}

/** Uniform summary used for submit-result, live tickers and standings. */
export function summarize(sport: Sport, evts: ScoreEvent[], cfg: ScoringConfig): Summary {
  const live = evts.filter(e => !e.voided).sort((a, b) => a.seq - b.seq);
  const win = (h: number, a: number): Side | undefined => (h > a ? 'home' : a > h ? 'away' : undefined);
  switch (sport) {
    case 'badminton': case 'pickleball': {
      const s = rally(live, cfg);
      return { home: s.gamesWon.home, away: s.gamesWon.away, detail: s.games.filter(g => g.home + g.away > 0).map(g => `${g.home}-${g.away}`).join(', '), winner: s.winner, isDraw: false, finished: !!s.winner, headline: `${s.gamesWon.home}–${s.gamesWon.away} games` };
    }
    case 'football': {
      const s = football(live), ph = s.pens.home.filter(Boolean).length, pa = s.pens.away.filter(Boolean).length;
      const pens = s.pens.home.length + s.pens.away.length > 0;
      const w = win(s.goals.home, s.goals.away) ?? (pens ? win(ph, pa) : undefined);
      return { home: s.goals.home, away: s.goals.away, detail: `${s.goals.home}-${s.goals.away}${pens ? ` (pens ${ph}-${pa})` : ''}`, winner: w, isDraw: !w && s.period === 'END', finished: s.period === 'END', headline: `${s.goals.home}–${s.goals.away}` };
    }
    case 'box_cricket': {
      const s = cricket(live, cfg), [a, b] = s.innings, h = s.innings.find(i => i.batting === 'home'), aw = s.innings.find(i => i.batting === 'away');
      const fmt = (i?: Innings) => (i ? `${i.runs}/${i.wickets} (${overs(i.legalBalls, cfg.cricket?.ballsPerOver)})` : 'yet to bat');
      return { home: h?.runs ?? 0, away: aw?.runs ?? 0, detail: `${fmt(h)} v ${fmt(aw)}`, winner: s.winner, isDraw: s.isTie, finished: s.done, headline: b ? `${b.runs}/${b.wickets} chasing ${s.target}` : `${a.runs}/${a.wickets}` };
    }
    case 'frisbee': {
      const s = frisbee(live, cfg);
      return { home: s.score.home, away: s.score.away, detail: `${s.score.home}-${s.score.away}${s.capped ? ' (cap)' : ''}${s.spirit ? ` · spirit ${s.spirit.home}/${s.spirit.away}` : ''}`, winner: s.winner, isDraw: false, finished: !!s.winner, headline: `${s.score.home}–${s.score.away}` };
    }
    case 'lagori': {
      const s = lagori(live, cfg), w = win(s.score.home, s.score.away);
      return { home: s.score.home, away: s.score.away, detail: s.perRound.map((r, i) => `R${i + 1} ${r.home}-${r.away}`).join(', '), winner: w, isDraw: s.done && !w, finished: s.done, headline: `${s.score.home}–${s.score.away}` };
    }
  }
}

export const SPORT_LABEL: Record<Sport, string> = { badminton: 'Badminton', pickleball: 'Pickleball', football: 'Football', box_cricket: 'Box cricket', frisbee: 'Ultimate frisbee', lagori: 'DSL Lagori' };

export function defaultScoring(sport: Sport): ScoringConfig {
  const base = { sport, autoScoring: true, points: { win: 3, draw: 1, loss: 0, walkoverWin: 3, walkoverLoss: 0 }, tieBreakers: ['points', 'head_to_head', 'score_diff', 'score_for'] as ScoringConfig['tieBreakers'] };
  switch (sport) {
    case 'badminton': return { ...base, points: { win: 2, draw: 0, loss: 0, walkoverWin: 2, walkoverLoss: 0 }, rally: { pointsToWin: 21, cap: 30, bestOf: 3 } };
    case 'pickleball': return { ...base, points: { win: 2, draw: 0, loss: 0, walkoverWin: 2, walkoverLoss: 0 }, rally: { pointsToWin: 11, cap: 15, bestOf: 3 } };
    case 'football': return { ...base, football: { halfMinutes: 20, extraTimeMinutes: 5, penalties: true, squadOnPitch: 7 } };
    case 'box_cricket': return { ...base, points: { win: 2, draw: 1, loss: 0, walkoverWin: 2, walkoverLoss: 0 }, tieBreakers: ['points', 'score_diff', 'head_to_head'], cricket: { overs: 6, ballsPerOver: 6, playersPerSide: 8 } };
    case 'frisbee': return { ...base, points: { win: 2, draw: 1, loss: 0, walkoverWin: 2, walkoverLoss: 0 }, frisbee: { pointsToWin: 13, cap: 15, halftimeAt: 7, timeoutsPerHalf: 2, spiritScoring: true } };
    case 'lagori': return { ...base, lagori: { rounds: 3, roundSeconds: 180, actions: [
      { key: 'restore', label: 'Lagori restored', points: 5, side: 'self' },
      { key: 'hit_out', label: 'Seeker hit out', points: 1, side: 'self' },
      { key: 'catch', label: 'Catch out', points: 2, side: 'self' },
      { key: 'foul', label: 'Foul', points: 1, side: 'opponent' },
    ] } };
  }
}
