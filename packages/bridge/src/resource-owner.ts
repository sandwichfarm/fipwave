export type CloseResource = () => Promise<void> | void;

/** Owns only returned close handles; it never discovers or terminates global processes. */
export class ResourceOwner {
  #resources: Array<{ name: string; close: CloseResource }> = [];
  #closed = false;
  #closing: Promise<void> | undefined;

  register(name: string, close: CloseResource): void {
    if (this.#closed) throw new Error('resource owner is closed');
    if (!/^[A-Za-z0-9._-]+$/.test(name) || typeof close !== 'function') throw new Error('resource owner registration is invalid');
    this.#resources.push({ name, close });
  }

  close(): Promise<void> {
    this.#closing ??= this.#closeAll();
    return this.#closing;
  }

  async #closeAll(): Promise<void> {
    this.#closed = true;
    let failures = 0;
    for (const resource of [...this.#resources].reverse()) {
      try { await resource.close(); } catch { failures += 1; }
    }
    if (failures) throw new Error(`owned resource cleanup failed (${failures})`);
  }
}
