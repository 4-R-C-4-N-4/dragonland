import { describe, expect, it } from 'vitest';
import { buildAnimPrompt, loadStyle } from '../../tools/art/config';

describe('animation prompts', () => {
  it('uses character-specific walk choreography instead of conflicting generic gait instructions', () => {
    const prompt = buildAnimPrompt({ id: 'rogue', name: 'Rogue', size: 'stage2', description: 'Two knives.', walkNotes: 'Low stealth glide, feet skim the ground.' }, loadStyle(), 'walk');
    expect(prompt).toContain('Low stealth glide, feet skim the ground.');
    expect(prompt).not.toContain('knee raised high');
    expect(prompt).toContain('6 equal square cells');
    expect(prompt).toContain('approved design');
  });
});
