const DATABASE_VERSION = 3;
const MANIFEST_STORE = 'activeManifests';
const INTENT_STORE = 'pendingIntents';
const STATE_STORE = 'storeState';
const DELETION_STORE = 'pendingObjectDeletions';
const FORMAT_VERSION = 1;
const RECOVERY_LIMIT = 64;
const DELETION_CLAIM_STALE_MS = 30_000;
function storeError(code, message, cause) {
    const error = new Error(message, cause === undefined ? undefined : { cause });
    Object.defineProperty(error, 'code', { value: code, enumerable: true });
    return error;
}
function abortError(cause) {
    const error = storeError('KVS_BINARY_BUNDLE_ABORTED', 'Binary bundle operation was aborted.', cause);
    error.name = 'AbortError';
    return error;
}
function assertSignal(signal) {
    if (signal?.aborted)
        throw abortError(signal.reason);
}
function operationSignal(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw storeError('KVS_BINARY_BUNDLE_INPUT_INVALID', 'Binary bundle operation options must be an object.');
    }
    const signal = options.signal;
    if (signal !== undefined && (!signal || typeof signal !== 'object' ||
        typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' ||
        typeof signal.removeEventListener !== 'function')) {
        throw storeError('KVS_BINARY_BUNDLE_INPUT_INVALID', 'Binary bundle AbortSignal is invalid.');
    }
    return signal;
}
function positiveOption(value, fallback, label) {
    const normalized = value ?? fallback;
    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
        throw new TypeError(`${label} must be a positive safe integer.`);
    }
    return normalized;
}
function canonicalIntegrity(value) {
    if (typeof value !== 'string' || !value.startsWith('sha256-'))
        return false;
    const payload = value.slice(7);
    if (/^[0-9a-f]{64}$/u.test(payload))
        return true;
    if (!/^[A-Za-z0-9+/]{43}=$/u.test(payload))
        return false;
    try {
        const decoded = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
        let binary = '';
        for (const byte of decoded)
            binary += String.fromCharCode(byte);
        return decoded.byteLength === 32 && btoa(binary) === payload;
    }
    catch {
        return false;
    }
}
function requireString(value, label, maximum) {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.includes('\0')) {
        throw storeError('KVS_BINARY_BUNDLE_INPUT_INVALID', `${label} is invalid.`);
    }
    return value;
}
function normalizeKey(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw storeError('KVS_BINARY_BUNDLE_INPUT_INVALID', 'Binary bundle key must be an object.');
    }
    const namespace = requireString(input.namespace, 'Binary bundle namespace', 512);
    const name = requireString(input.name, 'Binary bundle name', 256);
    if (!canonicalIntegrity(input.integrity)) {
        throw storeError('KVS_BINARY_BUNDLE_INPUT_INVALID', 'Binary bundle integrity is invalid.');
    }
    return {
        namespace,
        name,
        integrity: input.integrity,
        key: JSON.stringify([FORMAT_VERSION, namespace, name, input.integrity])
    };
}
function safePath(value) {
    const path = requireString(value, 'Binary bundle file path', 1024);
    if (path.startsWith('/') || path.startsWith('\\') || path.includes('\\') ||
        path.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
        throw storeError('KVS_BINARY_BUNDLE_INPUT_INVALID', 'Binary bundle file path is unsafe.');
    }
    return path;
}
function ownedBytes(value) {
    if (value instanceof ArrayBuffer)
        return new Uint8Array(value.slice(0));
    if (value instanceof Uint8Array)
        return Uint8Array.from(value);
    throw storeError('KVS_BINARY_BUNDLE_INPUT_INVALID', 'Binary bundle file bytes are invalid.');
}
function integrityHex(integrity) {
    const payload = integrity.slice(7);
    if (/^[0-9a-f]{64}$/u.test(payload))
        return payload;
    return [...Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))]
        .map((value) => value.toString(16).padStart(2, '0')).join('');
}
function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
}
function transactionComplete(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    });
}
function mappedMetadataError(error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string')
        return error;
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        return storeError('KVS_BINARY_OPFS_QUOTA', 'Binary bundle metadata quota was exceeded.', error);
    }
    return storeError('KVS_BINARY_OPFS_OPEN_FAILED', 'Binary bundle metadata operation failed.', error);
}
function manifestValid(value, key) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const candidate = value;
    if (!(candidate.formatVersion === FORMAT_VERSION &&
        typeof candidate.key === 'string' && (key === undefined || candidate.key === key) &&
        typeof candidate.namespace === 'string' && candidate.namespace.length > 0 &&
        candidate.namespace.length <= 512 && !candidate.namespace.includes('\0') &&
        typeof candidate.name === 'string' && candidate.name.length > 0 &&
        candidate.name.length <= 256 && !candidate.name.includes('\0') &&
        canonicalIntegrity(candidate.integrity) &&
        candidate.key === JSON.stringify([
            FORMAT_VERSION,
            candidate.namespace,
            candidate.name,
            candidate.integrity
        ]) &&
        Array.isArray(candidate.files) && candidate.files.length > 0 &&
        Number.isSafeInteger(candidate.totalBytes) && Number(candidate.totalBytes) >= 0 &&
        Number.isSafeInteger(candidate.generation) && Number(candidate.generation) > 0 &&
        Number.isSafeInteger(candidate.epoch) && Number(candidate.epoch) >= 0 &&
        Number.isSafeInteger(candidate.createdAt) && Number(candidate.createdAt) >= 0 &&
        Number.isSafeInteger(candidate.lastAccessedAt) &&
        Number(candidate.lastAccessedAt) >= Number(candidate.createdAt))) {
        return false;
    }
    let totalBytes = 0;
    let previousPath = null;
    for (const file of candidate.files) {
        if (!file || typeof file !== 'object' || typeof file.path !== 'string' ||
            file.path.length === 0 || file.path.length > 1024 || file.path.includes('\0') ||
            file.path.startsWith('/') || file.path.startsWith('\\') || file.path.includes('\\') ||
            file.path.split('/').some((part) => part.length === 0 || part === '.' || part === '..') ||
            (previousPath !== null && file.path <= previousPath) ||
            !Number.isSafeInteger(file.size) || file.size < 0 ||
            !canonicalIntegrity(file.integrity) || !file.object ||
            !/^[0-9a-f]{64}$/u.test(file.object.key) || file.object.size !== file.size ||
            file.object.integrity !== file.integrity) {
            return false;
        }
        totalBytes += file.size;
        if (!Number.isSafeInteger(totalBytes))
            return false;
        previousPath = file.path;
    }
    return totalBytes === candidate.totalBytes;
}
export function createOpfsBinaryBundleStore(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('OPFS binary bundle store options must be an object.');
    }
    const indexedDB = options.indexedDB ?? globalThis.indexedDB;
    const subtleCrypto = options.subtleCrypto ?? globalThis.crypto?.subtle;
    const now = options.now ?? Date.now;
    if (typeof options.databaseName !== 'string' || options.databaseName.length === 0 ||
        options.databaseName.length > 512 || options.databaseName.includes('\0')) {
        throw new TypeError('databaseName must be a non-empty string of at most 512 code units.');
    }
    if (typeof now !== 'function')
        throw new TypeError('now must be a function.');
    const maxFiles = positiveOption(options.maxFilesPerBundle, 256, 'maxFilesPerBundle');
    const maxBytes = positiveOption(options.maxBundleBytes, 256 * 1024 * 1024, 'maxBundleBytes');
    const maxStoredBundles = positiveOption(options.maxStoredBundles, 1024, 'maxStoredBundles');
    const maxStoreBytes = positiveOption(options.maxStoreBytes, 256 * 1024 * 1024, 'maxStoreBytes');
    const ttlMs = positiveOption(options.ttlMs, 30 * 24 * 60 * 60 * 1000, 'ttlMs');
    const intentStaleMs = Math.min(ttlMs, 5 * 60 * 1000);
    const intentHeartbeatMs = Math.max(1, Math.floor(intentStaleMs / 3));
    const recoveryLimit = positiveOption(options.recoveryBatchSize, RECOVERY_LIMIT, 'recoveryBatchSize');
    let released = false;
    let establishment = null;
    const generations = new Map();
    const objectScope = (async () => {
        if (!subtleCrypto?.digest)
            return '';
        const digest = new Uint8Array(await subtleCrypto.digest('SHA-256', new TextEncoder().encode(options.databaseName)));
        return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
    })();
    async function scopedObjectKey(integrity) {
        const scope = await objectScope;
        const digest = new Uint8Array(await subtleCrypto.digest('SHA-256', new TextEncoder().encode(`${scope}:${integrityHex(integrity)}`)));
        return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
    }
    async function openDatabase() {
        if (released)
            throw storeError('KVS_BINARY_BUNDLE_RELEASED', 'Binary bundle store was released.');
        if (!indexedDB?.open) {
            throw storeError('KVS_BINARY_BUNDLE_INDEXEDDB_UNAVAILABLE', 'IndexedDB metadata is unavailable.');
        }
        let request;
        try {
            request = indexedDB.open(options.databaseName, DATABASE_VERSION);
        }
        catch (error) {
            throw mappedMetadataError(error);
        }
        return new Promise((resolve, reject) => {
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains(MANIFEST_STORE)) {
                    database.createObjectStore(MANIFEST_STORE, { keyPath: 'key' });
                }
                if (!database.objectStoreNames.contains(INTENT_STORE)) {
                    database.createObjectStore(INTENT_STORE, { keyPath: 'token' });
                }
                if (!database.objectStoreNames.contains(STATE_STORE)) {
                    database.createObjectStore(STATE_STORE, { keyPath: 'key' });
                }
                if (!database.objectStoreNames.contains(DELETION_STORE)) {
                    database.createObjectStore(DELETION_STORE, { keyPath: 'key' });
                }
            };
            request.onsuccess = () => {
                request.result.onversionchange = () => request.result.close();
                resolve(request.result);
            };
            request.onerror = () => reject(mappedMetadataError(request.error));
            request.onblocked = () => reject(storeError('KVS_BINARY_OPFS_OPEN_FAILED', 'OPFS metadata open was blocked.'));
        });
    }
    async function finishObjectDeletions(database, deletions) {
        const remaining = new Set(deletions.map(({ key }) => key));
        const cleanupToken = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
        let retryDelayMs = 20;
        while (remaining.size > 0) {
            if (released)
                throw storeError('KVS_BINARY_BUNDLE_RELEASED', 'Binary bundle store was released.');
            const claim = database.transaction(DELETION_STORE, 'readwrite');
            const deletionStore = claim.objectStore(DELETION_STORE);
            const claimed = [];
            const claimedAt = Date.now();
            for (const key of remaining) {
                const current = await requestResult(deletionStore.get(key));
                if (!current) {
                    remaining.delete(key);
                    continue;
                }
                const activeClaim = typeof current.cleanupToken === 'string' &&
                    Number.isSafeInteger(current.cleanupClaimedAt) &&
                    claimedAt - Number(current.cleanupClaimedAt) <= DELETION_CLAIM_STALE_MS;
                if (activeClaim && current.cleanupToken !== cleanupToken)
                    continue;
                const owned = { ...current, cleanupToken, cleanupClaimedAt: claimedAt };
                deletionStore.put(owned);
                claimed.push(owned);
            }
            await transactionComplete(claim);
            if (claimed.length === 0) {
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                retryDelayMs = Math.min(retryDelayMs * 2, 250);
                continue;
            }
            retryDelayMs = 20;
            for (const deletion of claimed) {
                const ownership = database.transaction(DELETION_STORE, 'readonly');
                const owned = await requestResult(ownership.objectStore(DELETION_STORE).get(deletion.key));
                await transactionComplete(ownership);
                if (owned?.cleanupToken !== cleanupToken)
                    continue;
                await options.objectStore.delete(deletion.key);
                const complete = database.transaction(DELETION_STORE, 'readwrite');
                const store = complete.objectStore(DELETION_STORE);
                const current = await requestResult(store.get(deletion.key));
                if (current?.cleanupToken === cleanupToken)
                    store.delete(deletion.key);
                await transactionComplete(complete);
                remaining.delete(deletion.key);
            }
        }
    }
    async function pendingObjectDeletions(database, keys) {
        const transaction = database.transaction(DELETION_STORE, 'readonly');
        const values = await requestResult(transaction.objectStore(DELETION_STORE).getAll());
        await transactionComplete(transaction);
        return keys ? values.filter(({ key }) => keys.has(key)) : values;
    }
    async function claimStaleIntentObjects(database, staleBefore) {
        const transaction = database.transaction([MANIFEST_STORE, INTENT_STORE, DELETION_STORE], 'readwrite');
        const manifests = await requestResult(transaction.objectStore(MANIFEST_STORE).getAll());
        const intents = await requestResult(transaction.objectStore(INTENT_STORE).getAll());
        const stale = intents.filter((intent) => {
            const heartbeatAt = Number.isSafeInteger(intent.heartbeatAt)
                ? intent.heartbeatAt
                : intent.createdAt;
            return Number.isSafeInteger(heartbeatAt) && heartbeatAt <= staleBefore;
        }).slice(0, recoveryLimit);
        const staleTokens = new Set(stale.map(({ token }) => token));
        const referenced = new Set();
        for (const manifest of manifests) {
            if (!manifestValid(manifest))
                continue;
            for (const file of manifest.files)
                referenced.add(file.object.key);
        }
        for (const intent of intents) {
            if (staleTokens.has(intent.token))
                continue;
            if (!Array.isArray(intent.objects))
                continue;
            for (const object of intent.objects)
                referenced.add(object.key);
        }
        const claimed = new Map();
        const deletionStore = transaction.objectStore(DELETION_STORE);
        const intentStore = transaction.objectStore(INTENT_STORE);
        for (const intent of stale) {
            if (Array.isArray(intent.objects)) {
                for (const descriptor of intent.objects) {
                    if (referenced.has(descriptor.key) || claimed.has(descriptor.key))
                        continue;
                    const deletion = { key: descriptor.key, descriptor, createdAt: now() };
                    deletionStore.put(deletion);
                    claimed.set(descriptor.key, deletion);
                }
            }
            intentStore.delete(intent.token);
        }
        await transactionComplete(transaction);
        return [...claimed.values()];
    }
    async function recover() {
        const database = await openDatabase();
        try {
            await finishObjectDeletions(database, (await pendingObjectDeletions(database)).slice(0, recoveryLimit));
            const staleBefore = now() - intentStaleMs;
            const claimed = await claimStaleIntentObjects(database, staleBefore);
            await finishObjectDeletions(database, claimed);
            await options.objectStore.cleanupStaging?.({
                limit: recoveryLimit,
                createdBefore: now() - Math.min(ttlMs, 24 * 60 * 60 * 1000)
            });
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && typeof error.code === 'string' &&
                new Set([
                    'KVS_BINARY_OPFS_UNSUPPORTED',
                    'KVS_BINARY_OPFS_INSECURE_CONTEXT',
                    'KVS_BINARY_OPFS_OPEN_FAILED',
                    'KVS_BINARY_OPFS_QUOTA'
                ]).has(error.code)) {
                throw error;
            }
            throw storeError('KVS_BINARY_OPFS_RECOVERY_FAILED', 'OPFS recovery failed.', error);
        }
        finally {
            database.close();
        }
    }
    async function establish() {
        establishment ??= recover();
        return establishment;
    }
    async function normalize(input, signal) {
        const key = normalizeKey(input);
        if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > maxFiles) {
            throw storeError('KVS_BINARY_BUNDLE_LIMIT_EXCEEDED', 'Binary bundle file count is invalid.');
        }
        if (!subtleCrypto?.digest) {
            throw storeError('KVS_BINARY_BUNDLE_CRYPTO_UNAVAILABLE', 'SHA-256 is unavailable.');
        }
        const paths = new Set();
        const files = [];
        let totalBytes = 0;
        for (const candidate of input.files) {
            assertSignal(signal);
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
                throw storeError('KVS_BINARY_BUNDLE_INPUT_INVALID', 'Binary bundle file is invalid.');
            }
            const path = safePath(candidate.path);
            if (paths.has(path))
                throw storeError('KVS_BINARY_BUNDLE_INPUT_INVALID', 'Binary bundle path is duplicated.');
            paths.add(path);
            if (!canonicalIntegrity(candidate.integrity)) {
                throw storeError('KVS_BINARY_BUNDLE_INPUT_INVALID', 'Binary bundle file integrity is invalid.');
            }
            const bytes = ownedBytes(candidate.bytes);
            if (candidate.size !== bytes.byteLength) {
                throw storeError('KVS_BINARY_BUNDLE_INPUT_INVALID', 'Binary bundle file size does not match.');
            }
            const actual = new Uint8Array(await subtleCrypto.digest('SHA-256', bytes));
            if ([...actual].map((value) => value.toString(16).padStart(2, '0')).join('') !== integrityHex(candidate.integrity)) {
                throw storeError('KVS_BINARY_BUNDLE_INTEGRITY_MISMATCH', 'Binary bundle file integrity does not match.');
            }
            totalBytes += bytes.byteLength;
            if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) {
                throw storeError('KVS_BINARY_BUNDLE_LIMIT_EXCEEDED', 'Binary bundle exceeds maxBundleBytes.');
            }
            const objectKey = await scopedObjectKey(candidate.integrity);
            files.push({
                path,
                size: bytes.byteLength,
                integrity: candidate.integrity,
                object: { key: objectKey, size: bytes.byteLength, integrity: candidate.integrity },
                bytes
            });
        }
        if (totalBytes > maxStoreBytes) {
            throw storeError('KVS_BINARY_BUNDLE_LIMIT_EXCEEDED', 'Binary bundle exceeds maxStoreBytes.');
        }
        files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
        return { key, files, totalBytes };
    }
    async function deleteNormalized(key, condition) {
        const database = await openDatabase();
        let manifest;
        let deletions = [];
        try {
            const transaction = database.transaction([MANIFEST_STORE, INTENT_STORE, STATE_STORE, DELETION_STORE], 'readwrite');
            const manifests = transaction.objectStore(MANIFEST_STORE);
            manifest = await requestResult(manifests.get(key.key));
            if (condition) {
                if (!manifestValid(manifest, key.key) ||
                    manifest.generation !== condition.generation || manifest.epoch !== condition.epoch ||
                    !(condition.expiredAt < manifest.lastAccessedAt ||
                        condition.expiredAt - manifest.lastAccessedAt > ttlMs)) {
                    await transactionComplete(transaction);
                    return undefined;
                }
            }
            manifests.delete(key.key);
            const state = transaction.objectStore(STATE_STORE);
            const stateKey = `generation:${key.key}`;
            const value = await requestResult(state.get(stateKey));
            const next = value && typeof value === 'object' &&
                Number.isSafeInteger(value.value)
                ? Number(value.value) + 1
                : 1;
            state.put({ key: stateKey, value: next });
            if (manifestValid(manifest, key.key)) {
                const manifestValues = await requestResult(manifests.getAll());
                const intentValues = await requestResult(transaction.objectStore(INTENT_STORE).getAll());
                const referenced = new Set();
                for (const value of manifestValues) {
                    if (!manifestValid(value))
                        continue;
                    for (const { object } of value.files)
                        referenced.add(object.key);
                }
                for (const intent of intentValues) {
                    if (!Array.isArray(intent.objects))
                        continue;
                    for (const object of intent.objects)
                        referenced.add(object.key);
                }
                const deletionStore = transaction.objectStore(DELETION_STORE);
                const byKey = new Map();
                for (const { object } of manifest.files) {
                    if (referenced.has(object.key) || byKey.has(object.key))
                        continue;
                    const deletion = { key: object.key, descriptor: object, createdAt: now() };
                    deletionStore.put(deletion);
                    byKey.set(object.key, deletion);
                }
                deletions = [...byKey.values()];
            }
            await transactionComplete(transaction);
            await finishObjectDeletions(database, deletions);
            return manifestValid(manifest, key.key) ? manifest : undefined;
        }
        finally {
            database.close();
        }
    }
    const store = {
        establish,
        getBackendStatus() {
            return Object.freeze({ policy: 'opfs-required', selected: 'opfs' });
        },
        async put(input, operationOptions = {}) {
            const signal = operationSignal(operationOptions);
            assertSignal(signal);
            await establish();
            assertSignal(signal);
            const normalized = await normalize(input, signal);
            const currentGeneration = (generations.get(normalized.key.key) ?? 0) + 1;
            generations.set(normalized.key.key, currentGeneration);
            const token = `${now()}:${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
            const objects = normalized.files.map(({ object }) => object);
            const database = await openDatabase();
            let previous;
            let evicted = [];
            let committedDeletions = [];
            let persistentGeneration = 0;
            let persistentEpoch = 0;
            let heartbeatTimer = null;
            let heartbeatFailure;
            let heartbeatPromise = Promise.resolve();
            try {
                const stateKey = `generation:${normalized.key.key}`;
                for (;;) {
                    const transaction = database.transaction([INTENT_STORE, STATE_STORE, DELETION_STORE], 'readwrite');
                    const completion = transactionComplete(transaction);
                    const deletionStore = transaction.objectStore(DELETION_STORE);
                    const conflicts = (await Promise.all(objects.map(({ key }) => requestResult(deletionStore.get(key))))).filter((value) => value !== undefined);
                    if (conflicts.length > 0) {
                        transaction.abort();
                        await completion.catch(() => { });
                        await finishObjectDeletions(database, conflicts);
                        continue;
                    }
                    const state = transaction.objectStore(STATE_STORE);
                    const epochValue = await requestResult(state.get('epoch'));
                    persistentEpoch = epochValue && typeof epochValue === 'object' &&
                        Number.isSafeInteger(epochValue.value)
                        ? Number(epochValue.value)
                        : 0;
                    const stateValue = await requestResult(state.get(stateKey));
                    persistentGeneration = stateValue && typeof stateValue === 'object' &&
                        Number.isSafeInteger(stateValue.value)
                        ? Number(stateValue.value) + 1
                        : 1;
                    state.put({ key: stateKey, value: persistentGeneration });
                    const timestamp = now();
                    transaction.objectStore(INTENT_STORE).put({
                        token,
                        key: normalized.key.key,
                        createdAt: timestamp,
                        heartbeatAt: timestamp,
                        generation: persistentGeneration,
                        epoch: persistentEpoch,
                        objects
                    });
                    await completion;
                    break;
                }
                const heartbeat = () => {
                    heartbeatPromise = heartbeatPromise.then(async () => {
                        const transaction = database.transaction([INTENT_STORE, DELETION_STORE], 'readwrite');
                        const store = transaction.objectStore(INTENT_STORE);
                        const intent = await requestResult(store.get(token));
                        if (!intent)
                            throw abortError();
                        const deletionStore = transaction.objectStore(DELETION_STORE);
                        const conflicts = await Promise.all(objects.map(({ key }) => requestResult(deletionStore.get(key))));
                        if (conflicts.some((value) => value !== undefined)) {
                            transaction.abort();
                            throw abortError();
                        }
                        store.put({ ...intent, heartbeatAt: now() });
                        await transactionComplete(transaction);
                    }).catch((error) => {
                        heartbeatFailure ??= error;
                    });
                };
                heartbeatTimer = setInterval(heartbeat, intentHeartbeatMs);
                for (const file of normalized.files) {
                    assertSignal(signal);
                    if (heartbeatFailure)
                        throw heartbeatFailure;
                    if (generations.get(normalized.key.key) !== currentGeneration)
                        throw abortError();
                    try {
                        await options.objectStore.put(file.object, file.bytes, signal ? { signal } : undefined);
                    }
                    catch (error) {
                        if (!(error instanceof Error && 'code' in error && error.code === 'KVS_BINARY_OPFS_QUOTA')) {
                            throw error;
                        }
                        await store.prune();
                        await options.objectStore.put(file.object, file.bytes, signal ? { signal } : undefined);
                    }
                    heartbeat();
                    await heartbeatPromise;
                    if (heartbeatFailure)
                        throw heartbeatFailure;
                }
                for (const file of normalized.files) {
                    await options.objectStore.get(file.object, signal ? { signal } : undefined);
                }
                const timestamp = now();
                const transaction = database.transaction([MANIFEST_STORE, INTENT_STORE, STATE_STORE, DELETION_STORE], 'readwrite');
                const manifests = transaction.objectStore(MANIFEST_STORE);
                const manifestValues = await requestResult(manifests.getAll());
                const previousValue = manifestValues.find((value) => manifestValid(value, normalized.key.key));
                if (manifestValid(previousValue, normalized.key.key))
                    previous = previousValue;
                const retained = manifestValues
                    .filter((value) => manifestValid(value) && value.key !== normalized.key.key)
                    .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);
                let retainedBytes = retained.reduce((sum, candidate) => sum + candidate.totalBytes, 0);
                let retainedCount = retained.length;
                evicted = retained.filter((candidate) => {
                    const expired = timestamp < candidate.lastAccessedAt ||
                        timestamp - candidate.lastAccessedAt > ttlMs;
                    const overBudget = retainedBytes + normalized.totalBytes > maxStoreBytes;
                    const overCount = retainedCount + 1 > maxStoredBundles;
                    if (!expired && !overBudget && !overCount)
                        return false;
                    retainedBytes -= candidate.totalBytes;
                    retainedCount -= 1;
                    return true;
                });
                const intents = transaction.objectStore(INTENT_STORE);
                const currentIntent = await requestResult(intents.get(token));
                const committedState = await requestResult(transaction.objectStore(STATE_STORE).get(stateKey));
                const committedEpoch = await requestResult(transaction.objectStore(STATE_STORE).get('epoch'));
                const latestPersistentGeneration = committedState && typeof committedState === 'object'
                    ? committedState.value
                    : undefined;
                const latestEpoch = committedEpoch && typeof committedEpoch === 'object' &&
                    Number.isSafeInteger(committedEpoch.value)
                    ? Number(committedEpoch.value)
                    : 0;
                const deletionStore = transaction.objectStore(DELETION_STORE);
                const deletionConflicts = await Promise.all(objects.map(({ key }) => requestResult(deletionStore.get(key))));
                if (!currentIntent || currentIntent.token !== token ||
                    currentIntent.key !== normalized.key.key ||
                    currentIntent.generation !== persistentGeneration ||
                    currentIntent.epoch !== persistentEpoch ||
                    generations.get(normalized.key.key) !== currentGeneration ||
                    latestPersistentGeneration !== persistentGeneration || latestEpoch !== persistentEpoch ||
                    deletionConflicts.some((value) => value !== undefined)) {
                    transaction.abort();
                    throw abortError();
                }
                const manifest = {
                    formatVersion: FORMAT_VERSION,
                    ...normalized.key,
                    files: normalized.files.map(({ path, size, integrity, object }) => ({ path, size, integrity, object })),
                    totalBytes: normalized.totalBytes,
                    generation: persistentGeneration,
                    epoch: persistentEpoch,
                    createdAt: timestamp,
                    lastAccessedAt: timestamp
                };
                for (const candidate of evicted)
                    manifests.delete(candidate.key);
                manifests.put(manifest);
                intents.delete(token);
                const allIntents = await requestResult(intents.getAll());
                const evictedKeys = new Set(evicted.map((candidate) => candidate.key));
                const referencedObjects = new Set(manifest.files.map(({ object }) => object.key));
                for (const candidate of retained) {
                    if (evictedKeys.has(candidate.key))
                        continue;
                    for (const { object } of candidate.files)
                        referencedObjects.add(object.key);
                }
                for (const intent of allIntents) {
                    if (intent.token === token || !Array.isArray(intent.objects))
                        continue;
                    for (const object of intent.objects)
                        referencedObjects.add(object.key);
                }
                const deletionCandidates = [
                    ...(previous?.files.map(({ object }) => object) ?? []),
                    ...evicted.flatMap((candidate) => candidate.files.map(({ object }) => object))
                ];
                const pendingByKey = new Map();
                for (const descriptor of deletionCandidates) {
                    if (referencedObjects.has(descriptor.key) || pendingByKey.has(descriptor.key))
                        continue;
                    const deletion = { key: descriptor.key, descriptor, createdAt: timestamp };
                    deletionStore.put(deletion);
                    pendingByKey.set(descriptor.key, deletion);
                }
                committedDeletions = [...pendingByKey.values()];
                await transactionComplete(transaction);
                await finishObjectDeletions(database, committedDeletions);
                return Object.freeze({
                    namespace: normalized.key.namespace,
                    name: normalized.key.name,
                    integrity: normalized.key.integrity,
                    files: Object.freeze(manifest.files.map(({ path, size, integrity }) => Object.freeze({ path, size, integrity }))),
                    totalBytes: normalized.totalBytes
                });
            }
            finally {
                if (heartbeatTimer !== null)
                    clearInterval(heartbeatTimer);
                await heartbeatPromise;
                database.close();
            }
        },
        async get(input, operationOptions = {}) {
            const signal = operationSignal(operationOptions);
            assertSignal(signal);
            await establish();
            assertSignal(signal);
            const key = normalizeKey(input);
            const database = await openDatabase();
            let manifest;
            try {
                const transaction = database.transaction(MANIFEST_STORE, 'readonly');
                manifest = await requestResult(transaction.objectStore(MANIFEST_STORE).get(key.key));
                await transactionComplete(transaction);
            }
            finally {
                database.close();
            }
            if (manifest === undefined)
                throw storeError('KVS_BINARY_BUNDLE_NOT_FOUND', 'Binary bundle was not found.');
            if (!manifestValid(manifest, key.key))
                throw storeError('KVS_BINARY_BUNDLE_CORRUPT', 'Binary bundle manifest is corrupt.');
            const timestamp = now();
            if (timestamp < manifest.lastAccessedAt || timestamp - manifest.lastAccessedAt > ttlMs) {
                await deleteNormalized(key, {
                    generation: manifest.generation,
                    epoch: manifest.epoch,
                    expiredAt: timestamp
                });
                throw storeError('KVS_BINARY_BUNDLE_NOT_FOUND', 'Binary bundle has expired.');
            }
            const files = [];
            for (const file of manifest.files) {
                assertSignal(signal);
                try {
                    const result = await options.objectStore.get(file.object, signal ? { signal } : undefined);
                    files.push(Object.freeze({ path: file.path, size: file.size, integrity: file.integrity, bytes: result.bytes }));
                }
                catch (error) {
                    if (error instanceof Error && 'code' in error && error.code === 'KVS_BINARY_OPFS_NOT_FOUND')
                        throw error;
                    if (error instanceof Error && 'code' in error && error.code === 'KVS_BINARY_OPFS_CORRUPT')
                        throw error;
                    throw storeError('KVS_BINARY_OPFS_READ_FAILED', 'OPFS bundle read failed.', error);
                }
            }
            const touchDatabase = await openDatabase();
            try {
                const transaction = touchDatabase.transaction(MANIFEST_STORE, 'readwrite');
                const manifests = transaction.objectStore(MANIFEST_STORE);
                const current = await requestResult(manifests.get(key.key));
                if (!manifestValid(current, key.key) || current.generation !== manifest.generation ||
                    current.epoch !== manifest.epoch) {
                    transaction.abort();
                    throw abortError();
                }
                manifests.put({ ...current, lastAccessedAt: timestamp });
                await transactionComplete(transaction);
            }
            finally {
                touchDatabase.close();
            }
            return Object.freeze({
                namespace: key.namespace,
                name: key.name,
                integrity: key.integrity,
                files: Object.freeze(files),
                totalBytes: manifest.totalBytes
            });
        },
        async delete(input, operationOptions = {}) {
            const signal = operationSignal(operationOptions);
            assertSignal(signal);
            await establish();
            assertSignal(signal);
            const key = normalizeKey(input);
            generations.set(key.key, (generations.get(key.key) ?? 0) + 1);
            await deleteNormalized(key);
        },
        async touch(input, operationOptions = {}) {
            const signal = operationSignal(operationOptions);
            assertSignal(signal);
            await establish();
            assertSignal(signal);
            const key = normalizeKey(input);
            const database = await openDatabase();
            try {
                const transaction = database.transaction(MANIFEST_STORE, 'readwrite');
                const manifests = transaction.objectStore(MANIFEST_STORE);
                const value = await requestResult(manifests.get(key.key));
                if (!manifestValid(value, key.key)) {
                    transaction.abort();
                    throw storeError('KVS_BINARY_BUNDLE_NOT_FOUND', 'Binary bundle was not found.');
                }
                manifests.put({ ...value, lastAccessedAt: now() });
                await transactionComplete(transaction);
            }
            finally {
                database.close();
            }
        },
        async getStats() {
            await establish();
            const database = await openDatabase();
            try {
                const transaction = database.transaction([MANIFEST_STORE, INTENT_STORE, DELETION_STORE], 'readonly');
                const values = await requestResult(transaction.objectStore(MANIFEST_STORE).getAll());
                const intents = await requestResult(transaction.objectStore(INTENT_STORE).getAll());
                const deletions = await requestResult(transaction.objectStore(DELETION_STORE).getAll());
                await transactionComplete(transaction);
                const manifests = values.filter((value) => manifestValid(value));
                const objects = new Map();
                for (const manifest of manifests) {
                    for (const file of manifest.files)
                        objects.set(file.object.key, file.object.size);
                }
                const referencedKeys = new Set(objects.keys());
                for (const intent of intents) {
                    if (!Array.isArray(intent.objects))
                        continue;
                    for (const object of intent.objects)
                        referencedKeys.add(object.key);
                }
                const pendingDeletionKeys = new Set(deletions.map(({ key }) => key));
                const physical = await options.objectStore.getStats?.({
                    referencedKeys,
                    pendingDeletionKeys
                });
                return Object.freeze({
                    backend: 'opfs',
                    bundles: manifests.length,
                    logicalBytes: manifests.reduce((sum, manifest) => sum + manifest.totalBytes, 0),
                    physicalObjectBytes: physical?.physicalObjectBytes ??
                        [...objects.values()].reduce((sum, size) => sum + size, 0),
                    stagingBytes: physical?.stagingBytes ?? 0,
                    orphanBytes: physical?.orphanBytes ?? 0,
                    pendingDeletionBytes: physical?.pendingDeletionBytes ?? 0
                });
            }
            finally {
                database.close();
            }
        },
        async prune() {
            await establish();
            const database = await openDatabase();
            let manifests;
            try {
                const transaction = database.transaction(MANIFEST_STORE, 'readonly');
                const values = await requestResult(transaction.objectStore(MANIFEST_STORE).getAll());
                await transactionComplete(transaction);
                manifests = values.filter((value) => manifestValid(value));
            }
            finally {
                database.close();
            }
            const timestamp = now();
            const expired = manifests.filter((manifest) => timestamp < manifest.lastAccessedAt || timestamp - manifest.lastAccessedAt > ttlMs);
            const removed = [];
            for (const manifest of expired) {
                const deleted = await deleteNormalized(normalizeKey({
                    namespace: manifest.namespace,
                    name: manifest.name,
                    integrity: manifest.integrity
                }), {
                    generation: manifest.generation,
                    epoch: manifest.epoch,
                    expiredAt: timestamp
                });
                if (deleted)
                    removed.push(deleted);
            }
            return Object.freeze({
                removedBundles: removed.length,
                removedBytes: removed.reduce((sum, manifest) => sum + manifest.totalBytes, 0)
            });
        },
        async clear() {
            await establish();
            const database = await openDatabase();
            let manifests;
            let deletions = [];
            try {
                const clear = database.transaction([MANIFEST_STORE, INTENT_STORE, STATE_STORE, DELETION_STORE], 'readwrite');
                const completion = transactionComplete(clear);
                const values = await requestResult(clear.objectStore(MANIFEST_STORE).getAll());
                const intents = await requestResult(clear.objectStore(INTENT_STORE).getAll());
                manifests = values.filter((value) => manifestValid(value));
                const deletionStore = clear.objectStore(DELETION_STORE);
                const existing = await requestResult(deletionStore.getAll());
                const byKey = new Map(existing.map((deletion) => [deletion.key, deletion]));
                const activeIntentObjects = new Set(intents.flatMap(({ objects }) => objects.map(({ key }) => key)));
                for (const manifest of manifests) {
                    for (const { object } of manifest.files) {
                        if (activeIntentObjects.has(object.key))
                            continue;
                        const deletion = { key: object.key, descriptor: object, createdAt: now() };
                        deletionStore.put(deletion);
                        byKey.set(deletion.key, deletion);
                    }
                }
                deletions = [...byKey.values()];
                clear.objectStore(MANIFEST_STORE).clear();
                const state = clear.objectStore(STATE_STORE);
                const epochValue = await requestResult(state.get('epoch'));
                const nextEpoch = epochValue && typeof epochValue === 'object' &&
                    Number.isSafeInteger(epochValue.value)
                    ? Number(epochValue.value) + 1
                    : 1;
                state.clear();
                state.put({ key: 'epoch', value: nextEpoch });
                await completion;
                await finishObjectDeletions(database, deletions);
            }
            finally {
                database.close();
            }
            return Object.freeze({
                removedBundles: manifests.length,
                removedBytes: manifests.reduce((sum, manifest) => sum + manifest.totalBytes, 0)
            });
        },
        async release() {
            if (released)
                return;
            released = true;
            generations.clear();
            await options.objectStore.release();
        }
    };
    return Object.freeze(store);
}
