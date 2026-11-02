// HTML presentation only; progression and battle rules remain in src/run.
import type { GameData, GeneralId } from '../../data';
import { getRunConfig, type RunState } from '../../run';

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const className = (data: GameData, id: string): string => data.classes.find((c) => c.id === id)?.name ?? id;

export function heroChoicesHtml(data: GameData, selected: GeneralId): string {
  return data.classes.map((c) => `<fieldset class="dl-hero-group"><legend>${esc(c.name)}</legend>${data.generals
    .filter((g) => data.unitById.get(g.unitId)!.classId === c.id)
    .map((g) => `<label class="dl-hero-card" data-testid="hero-card">
      <input type="radio" name="dl-gen" value="${g.id}" aria-label="${esc(g.name)}" ${g.id === selected ? 'checked' : ''}>
      <canvas class="dl-hero-portrait" data-portrait="${g.unitId}" aria-hidden="true" width="96" height="96"></canvas>
      <strong>${esc(g.name)}</strong><span class="dl-stage">${esc(c.name)} · ${data.unitById.get(g.unitId)!.line}</span>
    </label>`).join('')}</fieldset>`).join('');
}

export function selectedHeroHtml(data: GameData, id: GeneralId): string {
  const g = data.generalById.get(id)!;
  const u = data.unitById.get(g.unitId)!;
  const partner = getRunConfig().startingPartners[u.classId]!;
  return `<h3>Selected hero: ${esc(g.name)}</h3>
    <p>${esc(className(data, u.classId))} · ${u.line} role. Starts with ${esc(className(data, u.classId))} + ${esc(className(data, partner))}.</p>
    <p><strong>Special — ${esc(g.special.name)}:</strong> ${esc(g.special.description)}</p>
    <p class="dl-dim">Use your special in battle when its meter and MP are ready.</p>`;
}

export function campaignHelpHtml(data: GameData): string {
  return `<details class="dl-help"><summary>Class cycle, roles &amp; battle controls</summary>
    <p>Each class beats the next: ${data.classes.map((c) => `${esc(c.name)} → ${esc(className(data, c.strongAgainst))}`).join(' · ')}. Strong / weak labels compare your classes with the enemy troop mix.</p>
    <p>A: attack role, usually ranged (Beast birds and Construct undead fight in melee). M: medium melee role (Mage Adepts are ranged). Z: durable close-combat role. Check each species rather than relying on its letter alone.</p>
    <p>Disposition is fixed when you deploy: Fierce presses toward the enemy general, Mixed prioritizes enemy troops, Guard protects the general. Orders change during battle: Advance, Hold or Fall Back. Approach chooses the route: Direct, Far Flank or Near Flank.</p>
    <p>Enemy doctrine describes its squad disposition mix. Defeat an enemy general of a locked class to unlock that class for future recruits; it does not immediately add troops.</p>
  </details>`;
}

export function resultHtml(data: GameData, s: RunState): string {
  const r = s.lastSummary;
  if (!r) return '';
  const unitName = (id: string) => data.unitById.get(id)?.name ?? id;
  const namedList = (troops: typeof r.dead) => troops.map((t) => `<li>${esc(t.name)} (${esc(unitName(t.unitId))})</li>`).join('');
  const milestones = s.pendingMilestones;
  const upgradeStatus = milestones.length === 0 ? 'No hero upgrade awaiting choice.'
    : s.phase === 'rewards' ? `Hero upgrade available at level ${milestones.join(', ')}: a boon awaits your choice.`
    : `Unspent general milestone${milestones.length > 1 ? 's' : ''} at level${milestones.length > 1 ? 's' : ''} ${milestones.join(', ')}.`;
  return `<div class="dl-panel"><h2>${r.won ? 'Victory' : 'Defeat'}${r.boss ? ' over the warlord' : ''}</h2>
    <p>Company roster retained: ${s.roster.length} (includes benched troops${r.recovered.length ? ' and recovered wounded' : ''}).</p>
    ${r.survived !== undefined ? `<details><summary>Surviving deployment (${r.survived.length})</summary><ul class="dl-troop-list">${namedList(r.survived)}</ul></details>` : '<p>Surviving deployment: not recorded in this saved result.</p>'}
    <p>Benched: ${r.benched !== undefined ? r.benched : 'not recorded in this saved result'}.</p>
    <details><summary>Recovered wounded (${r.recovered.length})</summary><ul class="dl-troop-list">${namedList(r.recovered)}</ul></details>
    <details><summary>Permanent losses (${r.dead.length})</summary><ul class="dl-troop-list dl-fallen">${namedList(r.dead)}</ul></details>
    ${r.won ? `<p>Deployed survivors and recovered wounded earned ${r.xpAwarded} XP each · ${r.levelUps} level-ups.</p>` : ''}
    <h3>Promotions / evolutions (${r.evolutions.length})</h3>
    ${r.evolutions.length ? `<ul class="dl-troop-list">${r.evolutions.map((e) => `<li class="dl-evo">${esc(e.name)}: ${esc(unitName(e.from))} → ${esc(unitName(e.to))}</li>`).join('')}</ul>` : '<p>No troop evolutions this battle.</p>'}
    <p>General level: ${r.heroLevelFrom}${r.heroLevelTo !== r.heroLevelFrom ? ` → ${r.heroLevelTo}` : ''}.</p>
    <p>${upgradeStatus}</p>
    ${r.unlockedClass ? `<p class="dl-strong">New class unlocked: ${esc(className(data, r.unlockedClass))}! Available for recruiting.</p>` : '<p>No new class unlocked.</p>'}
  </div>`;
}
