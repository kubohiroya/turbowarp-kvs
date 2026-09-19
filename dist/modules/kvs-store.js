const DATABASE_NAME = 'tw-kvs-values-v1';
const STORE_NAME = 'values';
export class KvsError extends Error {
    code;
    constructor(code, message, cause) {
        super(`[KVS][${code}] ${message}`, cause === undefined ? undefined : { cause });
        this.name = 'KvsError';
        this.code = code;
    }
}
export class IndexedDbKvsStore {
    factory;
    databaseName;
    now;
    databasePromise;
    released = false;
    constructor(factory = indexedDB, databaseName = DATABASE_NAME, now = Date.now) {
        this.factory = factory;
        this.databaseName = databaseName;
        this.now = now;
    }
    async set(namespaceValue, keyValue, value) {
        const namespace = normalizeNamespace(namespaceValue);
        const key = normalizeKey(keyValue);
        const database = await this.database();
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put({
            id: entryId(namespace, key), namespace, key, value, updatedAt: this.now()
        });
        await transactionDone(transaction);
    }
    async get(namespaceValue, keyValue) {
        return (await this.read(namespaceValue, keyValue))?.value;
    }
    async has(namespaceValue, keyValue) {
        return (await this.read(namespaceValue, keyValue)) !== undefined;
    }
    async delete(namespaceValue, keyValue) {
        const namespace = normalizeNamespace(namespaceValue);
        const key = normalizeKey(keyValue);
        const database = await this.database();
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const id = entryId(namespace, key);
        const existed = (await requestResult(store.getKey(id))) !== undefined;
        if (existed)
            store.delete(id);
        await transactionDone(transaction);
        return existed;
    }
    async list(namespaceValue) {
        const namespace = normalizeNamespace(namespaceValue);
        const database = await this.database();
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const entries = await requestResult(transaction.objectStore(STORE_NAME).getAll());
        await transactionDone(transaction);
        return entries.filter((entry) => entry.namespace === namespace).map((entry) => entry.key).sort(compareText);
    }
    release() {
        this.released = true;
        void this.databasePromise?.then((database) => database.close());
        this.databasePromise = undefined;
    }
    async read(namespaceValue, keyValue) {
        const namespace = normalizeNamespace(namespaceValue);
        const key = normalizeKey(keyValue);
        const database = await this.database();
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const entry = await requestResult(transaction.objectStore(STORE_NAME).get(entryId(namespace, key)));
        await transactionDone(transaction);
        return entry;
    }
    database() {
        if (this.released)
            throw new KvsError('KVS_RELEASED', 'The store has been released.');
        this.databasePromise ??= openDatabase(this.factory, this.databaseName);
        return this.databasePromise;
    }
}
export function normalizeNamespace(value) {
    const normalized = value.normalize('NFC');
    if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(normalized)) {
        throw new KvsError('KVS_NAMESPACE_INVALID', 'Namespace must be 1-64 lowercase ASCII characters.');
    }
    return normalized;
}
export function normalizeKey(value) {
    const normalized = value.normalize('NFC');
    if (normalized.length === 0 || normalized.length > 512 || normalized.includes('\0')) {
        throw new KvsError('KVS_KEY_INVALID', 'Key must contain 1-512 characters and no NUL.');
    }
    if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) {
        throw new KvsError('KVS_KEY_INVALID', 'Key must not contain traversal segments.');
    }
    return normalized;
}
function entryId(namespace, key) {
    return `${namespace}\0${key}`;
}
function openDatabase(factory, name) {
    return new Promise((resolve, reject) => {
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new KvsError('KVS_STORAGE_FAILURE', 'Could not open IndexedDB.', request.error));
    });
}
function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new KvsError('KVS_STORAGE_FAILURE', 'IndexedDB request failed.', request.error));
    });
}
function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(new KvsError('KVS_STORAGE_FAILURE', 'IndexedDB transaction aborted.', transaction.error));
        transaction.onerror = () => reject(new KvsError('KVS_STORAGE_FAILURE', 'IndexedDB transaction failed.', transaction.error));
    });
}
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
