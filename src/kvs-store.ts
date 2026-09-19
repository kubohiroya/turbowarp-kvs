export interface KvsEntry {
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
  readonly updatedAt: number;
}

export interface KvsStore {
  set(namespace: string, key: string, value: string): Promise<void>;
  get(namespace: string, key: string): Promise<string | undefined>;
  has(namespace: string, key: string): Promise<boolean>;
  delete(namespace: string, key: string): Promise<boolean>;
  list(namespace: string): Promise<readonly string[]>;
  release(): void;
}

interface StoredEntry extends KvsEntry {
  readonly id: string;
}

const DATABASE_NAME = 'tw-kvs-values-v1';
const STORE_NAME = 'values';

export class KvsError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string, cause?: unknown) {
    super(`[KVS][${code}] ${message}`, cause === undefined ? undefined : {cause});
    this.name = 'KvsError';
    this.code = code;
  }
}

export class IndexedDbKvsStore implements KvsStore {
  private databasePromise: Promise<IDBDatabase> | undefined;
  private released = false;

  public constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly databaseName = DATABASE_NAME,
    private readonly now: () => number = Date.now
  ) {}

  public async set(namespaceValue: string, keyValue: string, value: string): Promise<void> {
    const namespace = normalizeNamespace(namespaceValue);
    const key = normalizeKey(keyValue);
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      id: entryId(namespace, key), namespace, key, value, updatedAt: this.now()
    } satisfies StoredEntry);
    await transactionDone(transaction);
  }

  public async get(namespaceValue: string, keyValue: string): Promise<string | undefined> {
    return (await this.read(namespaceValue, keyValue))?.value;
  }

  public async has(namespaceValue: string, keyValue: string): Promise<boolean> {
    return (await this.read(namespaceValue, keyValue)) !== undefined;
  }

  public async delete(namespaceValue: string, keyValue: string): Promise<boolean> {
    const namespace = normalizeNamespace(namespaceValue);
    const key = normalizeKey(keyValue);
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const id = entryId(namespace, key);
    const existed = (await requestResult(store.getKey(id))) !== undefined;
    if (existed) store.delete(id);
    await transactionDone(transaction);
    return existed;
  }

  public async list(namespaceValue: string): Promise<readonly string[]> {
    const namespace = normalizeNamespace(namespaceValue);
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const entries = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as StoredEntry[];
    await transactionDone(transaction);
    return entries.filter((entry) => entry.namespace === namespace).map((entry) => entry.key).sort(compareText);
  }

  public release(): void {
    this.released = true;
    void this.databasePromise?.then((database) => database.close());
    this.databasePromise = undefined;
  }

  private async read(namespaceValue: string, keyValue: string): Promise<StoredEntry | undefined> {
    const namespace = normalizeNamespace(namespaceValue);
    const key = normalizeKey(keyValue);
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const entry = await requestResult(transaction.objectStore(STORE_NAME).get(entryId(namespace, key))) as
      | StoredEntry
      | undefined;
    await transactionDone(transaction);
    return entry;
  }

  private database(): Promise<IDBDatabase> {
    if (this.released) throw new KvsError('KVS_RELEASED', 'The store has been released.');
    this.databasePromise ??= openDatabase(this.factory, this.databaseName);
    return this.databasePromise;
  }
}

export function normalizeNamespace(value: string): string {
  const normalized = value.normalize('NFC');
  if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(normalized)) {
    throw new KvsError('KVS_NAMESPACE_INVALID', 'Namespace must be 1-64 lowercase ASCII characters.');
  }
  return normalized;
}

export function normalizeKey(value: string): string {
  const normalized = value.normalize('NFC');
  if (normalized.length === 0 || normalized.length > 512 || normalized.includes('\0')) {
    throw new KvsError('KVS_KEY_INVALID', 'Key must contain 1-512 characters and no NUL.');
  }
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new KvsError('KVS_KEY_INVALID', 'Key must not contain traversal segments.');
  }
  return normalized;
}

function entryId(namespace: string, key: string): string {
  return `${namespace}\0${key}`;
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new KvsError('KVS_STORAGE_FAILURE', 'Could not open IndexedDB.', request.error));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new KvsError('KVS_STORAGE_FAILURE', 'IndexedDB request failed.', request.error));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new KvsError('KVS_STORAGE_FAILURE', 'IndexedDB transaction aborted.', transaction.error));
    transaction.onerror = () => reject(new KvsError('KVS_STORAGE_FAILURE', 'IndexedDB transaction failed.', transaction.error));
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
