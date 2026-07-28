import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { SqlLoaderError } from './errors';
import { loadSqlCatalog } from './load';
import { resolveSource } from './resolve';
import type { CatalogResult, LoadOptions, SqlEntry } from './types';

/** Options for {@link watchSql}. Load options apply to every rescan. */
export interface WatchOptions extends LoadOptions {
  /** Trailing debounce after a filesystem event, in ms. Default: 75. */
  debounceMs?: number;
  /** Maximum wait before a rescan during a sustained event burst, in ms. Default: 500. */
  maxWaitMs?: number;
  /**
   * Poll interval in ms. When set, `fs.watch` is not used at all — the
   * directory is rescanned on this interval and events fire only when the
   * content hash changes. Escape hatch for NFS, containers, and other
   * filesystems where native watching silently reports nothing.
   */
  poll?: number;
}

/** Payload of the `'change'` event. */
export interface SqlChangeEvent {
  /** The complete new snapshot. */
  snapshot: CatalogResult;
  /** IDs of queries that did not exist in the previous snapshot. */
  added: string[];
  /** IDs of queries that existed before but are now gone. */
  removed: string[];
  /** IDs whose content hash changed. */
  changed: string[];
}

/**
 * Watcher returned by {@link watchSql}.
 *
 * Always attach an `'error'` listener: scan failures during watching emit
 * `'error'` (keeping the last good snapshot) and an unhandled `'error'`
 * event crashes the process, per EventEmitter semantics.
 */
export interface SqlWatcher extends EventEmitter {
  on(event: 'ready', listener: (snapshot: CatalogResult) => void): this;
  on(event: 'change', listener: (event: SqlChangeEvent) => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  on(event: 'close', listener: () => void): this;
  once(event: 'ready', listener: (snapshot: CatalogResult) => void): this;
  once(event: 'change', listener: (event: SqlChangeEvent) => void): this;
  once(event: 'error', listener: (error: unknown) => void): this;
  once(event: 'close', listener: () => void): this;
  /** Last successful snapshot, or `null` before the first scan completes. */
  readonly snapshot: CatalogResult | null;
  /** Stop watching. Idempotent. */
  close(): void;
  [Symbol.asyncDispose](): Promise<void>;
}

function diffIds(previous: readonly SqlEntry[], next: readonly SqlEntry[]) {
  const before = new Map(previous.map((e) => [e.id, e.hash]));
  const after = new Map(next.map((e) => [e.id, e.hash]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [id, hash] of after) {
    const prevHash = before.get(id);
    if (prevHash === undefined) added.push(id);
    else if (prevHash !== hash) changed.push(id);
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed.push(id);
  }
  return { added, removed, changed };
}

function listDirsSync(rootDir: string, followSymlinks: boolean): string[] {
  const dirs: string[] = [rootDir];
  const walk = (dirAbs: string): void => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink() && !followSymlinks) continue;
      const abs = path.join(dirAbs, dirent.name);
      let isDir = dirent.isDirectory();
      if (dirent.isSymbolicLink()) {
        try {
          isDir = fs.statSync(abs).isDirectory();
        } catch {
          continue;
        }
      }
      if (isDir) {
        dirs.push(abs);
        walk(abs);
      }
    }
  };
  walk(rootDir);
  return dirs;
}

class SqlWatcherImpl extends EventEmitter implements SqlWatcher {
  #source: string | URL;
  #rootDir: string;
  #options: WatchOptions;
  #debounceMs: number;
  #maxWaitMs: number;
  #closed = false;
  #scanning = false;
  #dirty = false;
  #snapshot: CatalogResult | null = null;
  #recursiveWatcher: fs.FSWatcher | null = null;
  #dirWatchers = new Map<string, fs.FSWatcher>();
  #perDirectoryMode = false;
  #pollTimer: NodeJS.Timeout | null = null;
  #debounceTimer: NodeJS.Timeout | null = null;
  #maxWaitTimer: NodeJS.Timeout | null = null;

  constructor(source: string | URL, options: WatchOptions = {}) {
    super();
    this.#source = source;
    this.#rootDir = resolveSource(source).rootDir;
    this.#options = options;
    this.#debounceMs = options.debounceMs ?? 75;
    this.#maxWaitMs = options.maxWaitMs ?? 500;
    // Let callers attach listeners before the first scan or error fires.
    setImmediate(() => {
      if (this.#closed) return;
      this.#setupWatching();
      void this.#rescan(true);
    });
  }

  get snapshot(): CatalogResult | null {
    return this.#snapshot;
  }

  #setupWatching(): void {
    if (this.#options.poll !== undefined) {
      this.#pollTimer = setInterval(() => this.#markDirty(), this.#options.poll);
      return;
    }
    try {
      this.#recursiveWatcher = fs.watch(this.#rootDir, { recursive: true }, () =>
        this.#markDirty(),
      );
      this.#recursiveWatcher.on('error', (error) => this.#onWatcherError(error));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
        this.#perDirectoryMode = true;
        this.#refreshDirWatchers();
      } else {
        this.emit(
          'error',
          new SqlLoaderError(
            'ERR_WATCH_UNAVAILABLE',
            `Cannot watch ${this.#rootDir}: ${
              error instanceof Error ? error.message : String(error)
            }. Fix: pass the poll option (e.g. watchSql(dir, { poll: 1000 })) to fall back to interval rescans.`,
            { cause: error },
          ),
        );
      }
    }
  }

  #refreshDirWatchers(): void {
    if (!this.#perDirectoryMode || this.#closed) return;
    const wanted = new Set(listDirsSync(this.#rootDir, this.#options.followSymlinks ?? false));
    for (const [dir, watcher] of this.#dirWatchers) {
      if (!wanted.has(dir)) {
        watcher.close();
        this.#dirWatchers.delete(dir);
      }
    }
    for (const dir of wanted) {
      if (this.#dirWatchers.has(dir)) continue;
      try {
        const watcher = fs.watch(dir, () => this.#markDirty());
        watcher.on('error', (error) => this.#onWatcherError(error));
        this.#dirWatchers.set(dir, watcher);
      } catch {
        // Directory vanished between listing and watching; the next rescan
        // refreshes the watcher set.
      }
    }
  }

  #onWatcherError(error: unknown): void {
    if (this.#closed) return;
    // Editors doing atomic-save renames can surface transient watcher errors;
    // treat them as a dirty signal and keep watching.
    this.emit('error', error);
    this.#markDirty();
  }

  #markDirty(): void {
    if (this.#closed) return;
    this.#dirty = true;
    if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => this.#flush(), this.#debounceMs);
    if (this.#maxWaitTimer === null) {
      this.#maxWaitTimer = setTimeout(() => this.#flush(), this.#maxWaitMs);
    }
  }

  #flush(): void {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    if (this.#maxWaitTimer !== null) {
      clearTimeout(this.#maxWaitTimer);
      this.#maxWaitTimer = null;
    }
    void this.#rescan(false);
  }

  async #rescan(initial: boolean): Promise<void> {
    if (this.#closed) return;
    if (this.#scanning) {
      this.#dirty = true;
      return;
    }
    this.#scanning = true;
    this.#dirty = false;
    try {
      const next = await loadSqlCatalog(this.#source, this.#options);
      if (this.#closed) return;
      const previous = this.#snapshot;
      this.#refreshDirWatchers();
      if (initial || previous === null) {
        this.#snapshot = next;
        this.emit('ready', next);
      } else if (previous.hash !== next.hash) {
        this.#snapshot = next;
        this.emit('change', { snapshot: next, ...diffIds(previous.entries, next.entries) });
      }
      // Identical content: keep the previous snapshot object so references
      // handed to consumers stay stable across no-op filesystem events.
    } catch (error) {
      if (!this.#closed) this.emit('error', error);
    } finally {
      this.#scanning = false;
      if (this.#dirty && !this.#closed) {
        this.#dirty = false;
        void this.#rescan(this.#snapshot === null);
      }
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#pollTimer !== null) clearInterval(this.#pollTimer);
    if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer);
    if (this.#maxWaitTimer !== null) clearTimeout(this.#maxWaitTimer);
    this.#recursiveWatcher?.close();
    for (const watcher of this.#dirWatchers.values()) watcher.close();
    this.#dirWatchers.clear();
    this.emit('close');
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }
}

/**
 * Watch a SQL directory and rescan on changes (development helper).
 *
 * Every filesystem event is treated as an untyped "dirty" signal: after a
 * debounce the whole directory is rescanned and hash-diffed, so duplicate
 * and rename events collapse into a single accurate `'change'` emission.
 *
 * @example
 * const watcher = watchSql(new URL('./sql/', import.meta.url));
 * watcher.on('error', console.error);
 * watcher.on('change', ({ snapshot, changed }) => reload(snapshot.tree, changed));
 */
export function watchSql(source: string | URL, options?: WatchOptions): SqlWatcher {
  return new SqlWatcherImpl(source, options);
}
