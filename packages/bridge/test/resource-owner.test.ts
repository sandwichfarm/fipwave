import { describe, expect, it, vi } from 'vitest';

import { ResourceOwner } from '../src/resource-owner.js';

describe('ResourceOwner', () => {
  it('closes only registered resources once in reverse registration order', async () => {
    const owner = new ResourceOwner();
    const closed: string[] = [];
    const unowned = vi.fn(async () => { closed.push('unowned'); });
    owner.register('bridge', async () => { closed.push('bridge'); });
    owner.register('worker', async () => { closed.push('worker'); });

    await owner.close();
    await owner.close();

    expect(closed).toEqual(['worker', 'bridge']);
    expect(unowned).not.toHaveBeenCalled();
    expect(() => owner.register('late', async () => {})).toThrow('resource owner is closed');
  });

  it('aggregates bounded safe cleanup failures while closing remaining owned resources', async () => {
    const owner = new ResourceOwner();
    const last = vi.fn(async () => { throw new Error('nsec1must-not-leak'); });
    const first = vi.fn(async () => {});
    owner.register('first', first);
    owner.register('last', last);

    await expect(owner.close()).rejects.toThrow('owned resource cleanup failed (1)');
    expect(last).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
    await expect(owner.close()).rejects.toThrow('owned resource cleanup failed (1)');
  });
});
