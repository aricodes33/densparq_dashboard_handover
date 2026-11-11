// Standings from VERIFIED results only (submitted/disputed results show as provisional). docs/business-rules.md §6
import type { Match, Registration, ScoringConfig, StandingOverride, StandingRow, TieBreaker } from './types';

export function computeStandings(matches: Match[], regs: Registration[], cfg: ScoringConfig, qualifiersPerGroup: number, overrides: StandingOverride[] = []): StandingRow[] {
  const groupMatches = matches.filter(m => m.stage !== 'knockout');
  const byGroup = new Map<string, Match[]>();
  for (const m of groupMatches) { const g = m.group ?? 'League'; byGroup.set(g, [...(byGroup.get(g) ?? []), m]); }
  const name = (id: string) => regs.find(r => r.id === id)?.entryName ?? '—';
  const rows: StandingRow[] = [];
  for (const [group, ms] of byGroup) {
    const ids = [...new Set(ms.flatMap(m => [m.homeId, m.awayId]).filter(Boolean) as string[])];
    const table = new Map(ids.map(id => [id, blank(id, name(id), group)]));
    let provisional = false;
    for (const m of ms) {
      if (!m.result || !m.homeId || !m.awayId) continue;
      if (m.result.verification !== 'verified') { provisional = true; continue; }
      apply(table.get(m.homeId)!, table.get(m.awayId)!, m, cfg);
    }
    const sorted = rank([...table.values()], cfg.tieBreakers, ms);
    sorted.forEach((r, i) => { r.rank = i + 1; r.provisional = provisional; });
    // Approved overrides pin an entry to a rank; others shift around it.
    for (const o of overrides.filter(o => o.status === 'approved' && o.group === group)) {
      const idx = sorted.findIndex(r => r.regId === o.regId); if (idx < 0) continue;
      const [row] = sorted.splice(idx, 1); row.overridden = true; sorted.splice(o.rank - 1, 0, row);
      sorted.forEach((r, i) => { r.rank = i + 1; });
    }
    sorted.forEach(r => { r.qualified = r.rank <= qualifiersPerGroup && r.played > 0; });
    rows.push(...sorted);
  }
  return rows;
}

const blank = (regId: string, name: string, group: string): StandingRow => ({ regId, name, group, played: 0, won: 0, drawn: 0, lost: 0, scoreFor: 0, scoreAgainst: 0, diff: 0, points: 0, rank: 0, qualified: false, provisional: false });

function apply(h: StandingRow, a: StandingRow, m: Match, cfg: ScoringConfig) {
  const r = m.result!, p = cfg.points;
  h.played++; a.played++;
  h.scoreFor += r.homeScore; h.scoreAgainst += r.awayScore; a.scoreFor += r.awayScore; a.scoreAgainst += r.homeScore;
  h.diff = h.scoreFor - h.scoreAgainst; a.diff = a.scoreFor - a.scoreAgainst;
  if (r.walkover) {
    const [w, l] = r.walkover === 'home' ? [h, a] : [a, h];
    w.won++; l.lost++; w.points += p.walkoverWin; l.points += p.walkoverLoss; return;
  }
  if (r.isDraw) { h.drawn++; a.drawn++; h.points += p.draw; a.points += p.draw; return; }
  const [w, l] = r.winnerId === h.regId ? [h, a] : [a, h];
  w.won++; l.lost++; w.points += p.win; l.points += p.loss;
}

/** Ordered tie-breakers. head_to_head = mini-league among exactly the tied entries. draw_lots = stable by regId (backend: seeded RNG recorded in audit). */
export function rank(rows: StandingRow[], tbs: TieBreaker[], ms: Match[]): StandingRow[] {
  const order: TieBreaker[] = ['points', ...tbs.filter(t => t !== 'points')];
  const cmp = (a: StandingRow, b: StandingRow, keys: TieBreaker[], tied: StandingRow[]): number => {
    for (const k of keys) {
      let d = 0;
      if (k === 'points') d = b.points - a.points;
      else if (k === 'score_diff') d = b.diff - a.diff;
      else if (k === 'score_for') d = b.scoreFor - a.scoreFor;
      else if (k === 'wins') d = b.won - a.won;
      else if (k === 'head_to_head') d = h2h(b.regId, tied, ms) - h2h(a.regId, tied, ms);
      else if (k === 'draw_lots') d = a.regId < b.regId ? -1 : 1;
      if (d) return d;
    }
    return 0;
  };
  const s = [...rows].sort((a, b) => b.points - a.points);
  return s.sort((a, b) => cmp(a, b, order, s.filter(x => x.points === a.points)));
}

function h2h(id: string, tied: StandingRow[], ms: Match[]): number {
  const set = new Set(tied.map(t => t.regId)); let pts = 0;
  for (const m of ms) {
    if (!m.result || m.result.verification !== 'verified' || !set.has(m.homeId!) || !set.has(m.awayId!)) continue;
    if (m.homeId !== id && m.awayId !== id) continue;
    if (m.result.isDraw) pts += 1; else if (m.result.winnerId === id) pts += 3;
  }
  return pts;
}
