/// <reference types="node" />
/// <reference types="node" />
import { ConnectionOptions } from "tls";
import { MemcacheConnection } from "./lib/connection";
import { MemcacheNode } from "./lib/memcache-node";
export declare type CommandCallback = (conn: MemcacheConnection) => void;
export interface CompressorLibrary {
    compressSync(payload?: {
        input: string | number | Buffer | Record<string, unknown>;
    }): Buffer;
    decompressSync(payload: {
        input: string | number | Buffer;
    }): string | Buffer;
}
export declare type SingleServerEntry = {
    server: string;
    maxConnections?: number;
};
export declare type MultipleServerEntry = {
    servers: Array<SingleServerEntry>;
};
export declare type ServerConfig = {
    retryFailedServerInterval: number;
    failedServerOutTime: number;
    keepLastServer?: boolean;
};
export declare type ServerDefinition = {
    serverEntry: SingleServerEntry | MultipleServerEntry;
    config: ServerConfig;
};
export declare type ResolveCallback = <T extends any>(result: T) => void;
export declare type RejectCallback = (error: Error) => void;
export declare type ErrorFirstCallback = (error?: Error | null, data?: any) => void;
export declare type PackedData = {
    flag: number;
    data: string | Buffer;
    cmdTokens: string[];
    cmd?: string;
};
export declare type MemcacheClientOptions = {
    server: ServerDefinition | SingleServerEntry | MultipleServerEntry;
    ignoreNotStored?: boolean;
    lifetime?: number;
    noDelay?: boolean;
    cmdTimeout?: number;
    connectTimeout?: number;
    keepAlive?: number | false;
    keepDangleSocket?: boolean;
    dangleSocketWaitTimeout?: number;
    compressor?: CompressorLibrary;
    logger?: any;
    Promise?: PromiseConstructor;
    tls?: ConnectionOptions;
    /** if metadata flags are not set, assume values are all of type Buffer rather than plain text
     * this is for migration from other libraries that do not use the flags that this library uses
     * to denote the type of values stored in memcached
     */
    assumeBuffer?: boolean;
    /**
     * If provided, this will be used to determine which server to route a given key to
     * If not provided, all servers will be treated as redundant (keys can route to any server)
     */
    keyToServerHashFunction?: (servers: string[], key: string) => string;
};
export declare type CommandContext = {
    error?: Error | null;
    results: Record<string, unknown>;
    expectedResponses?: number;
    callback: ErrorFirstCallback;
};
export declare type QueuedCommandContext = CommandContext & {
    queuedTime: number;
};
export declare type ConnectionError = Error & {
    connecting?: boolean;
};
export interface MultiServerManager {
    doCmd(action: CommandCallback, key: string): void | Promise<unknown>;
    shutdown(): void;
    _getNode(key: string): MemcacheNode;
    _servers: Array<SingleServerEntry>;
    _exServers: Array<SingleServerEntry>;
    getServerKey(key: string): string;
}
