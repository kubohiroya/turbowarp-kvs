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
export declare class KvsError extends Error {
    readonly code: string;
    constructor(code: string, message: string, cause?: unknown);
}
export declare class IndexedDbKvsStore implements KvsStore {
    private readonly factory;
    private readonly databaseName;
    private readonly now;
    private databasePromise;
    private released;
    constructor(factory?: IDBFactory, databaseName?: string, now?: () => number);
    set(namespaceValue: string, keyValue: string, value: string): Promise<void>;
    get(namespaceValue: string, keyValue: string): Promise<string | undefined>;
    has(namespaceValue: string, keyValue: string): Promise<boolean>;
    delete(namespaceValue: string, keyValue: string): Promise<boolean>;
    list(namespaceValue: string): Promise<readonly string[]>;
    release(): void;
    private read;
    private database;
}
export declare function normalizeNamespace(value: string): string;
export declare function normalizeKey(value: string): string;
