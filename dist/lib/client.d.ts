/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import { Socket } from "net";
import EventEmitter from "events";
import { MemcacheClientOptions, ErrorFirstCallback, PackedData, MultiServerManager } from "../types";
import { MemcacheConnection } from "./connection";
import { DefaultLogger } from "memcache-parser";
declare type StoreParams = string | number | Buffer | Record<string, unknown>;
declare type CommonCommandOption = Readonly<{
    noreply?: boolean;
    expectedResponses?: number;
}>;
declare type StoreCommandOptions = CommonCommandOption & {
    ignoreNotStored?: boolean;
} & Readonly<{
    lifetime?: number;
    compress?: boolean;
}>;
export declare type CasCommandOptions = CommonCommandOption & StoreCommandOptions & Readonly<{
    casUniq: number | string;
}>;
declare type MetaGetOptions = StoreCommandOptions & {
    /** interpret key as base64 encoded binary value */
    keyAsBase64?: boolean;
    /** include the cas token in the response */
    includeCasToken?: boolean;
    /** return whether item has been hit before as a 0 or 1 */
    includeHasBeenHit?: boolean;
    /** return time since item was last accessed in seconds */
    includeLastAccessed?: boolean;
    /** return item TTL remaining in seconds (-1 for unlimited) */
    includeRemainingTtl?: boolean;
    /** don't bump the item in the LRU */
    dontBumpLru?: boolean;
    /** vivify on miss, takes TTL as a argument
     * Used to help with so called "dog piling" problems with recaching of popular
     * items. If supplied, and metaget does not find the item in cache, it will
     * create a stub item with the key and TTL as supplied. If such an item is
     * created a 'W' flag is added to the response to indicate to a client that they
     * have "won" the right to recache an item.
     *
     * The automatically created item has 0 bytes of data.
     *
     * Further requests will see a 'Z' flag to indicate that another client has
     * already received the win flag.
     */
    vivifyOnMiss?: number;
    /** Similar to "touch" and "gat" commands, updates the remaining TTL of an item if hit. */
    updateTtlOnHit?: number;
};
/**
 * Results specific to meta protocol
 */
export declare type MetaResult = {
    /** return whether item has been hit before the current request */
    hasBeenHit?: boolean;
    /** return time since item was last accessed in seconds */
    secondsSinceLastAccess?: number;
    /** opaque value - passing in this will return the same value, can be used to identify pipelined requests */
    opaqueValue?: string;
    /** remaining TTL in seconds (-1 for unlimited) */
    remainingTtl?: number;
    /**
     * if vivifyOnMiss was passed and we miss, indicates whether the current request won the right to recache the item
     * if we win, caller should do the underlying IO and store the result
     * if we lose, caller should wait for another client to do the IO and try again with a backoff/retry loop
     * NOTE: even if vivifyOnMiss was not passed on this request, if someone else passed it and won the right to recache,
     * this will be set to false explicitly with an undefined value in the response
     */
    wonRecache?: boolean;
    /** staleness can be set via meta delete as a way to keep the value there but encourage callers to refresh it */
    stale?: boolean;
    /** return flags */
    flags?: number;
    /** return key */
    key?: string;
    /** cas token returned if includeCasToken was passed */
    casUniq?: string;
};
declare type SocketCallback = (socket?: Socket) => void;
declare type OperationCallback<Error, Data> = (error?: Error | null, data?: Data) => void;
export declare type RetrievalCommandResponse<ValueType> = {
    tokens: string[];
    casUniq?: number | string;
    value: ValueType;
};
export declare type MetaRetrievalCommandResponse<ValueType> = MetaResult & {
    value: ValueType;
};
export declare type CasRetrievalCommandResponse<Type> = RetrievalCommandResponse<Type> & {
    casUniq: string | number;
};
export declare type StatsCommandResponse = Record<"STAT", Array<Array<string>>>;
export declare type MultiRetrievalResponse<ValueType = unknown> = Record<string, RetrievalCommandResponse<ValueType>>;
export declare type MultiMetaRetrievalResponse<ValueType = unknown> = Record<string, MetaRetrievalCommandResponse<ValueType>>;
export declare type MultiCasRetrievalResponse<ValueType = unknown> = Record<string, CasRetrievalCommandResponse<ValueType>>;
export interface MultiGetError<Keys extends string = string> {
    error: Error;
    serverKey: string;
    keys: Keys[];
}
export interface MultiRetrievalWithErrorsResponse<ValueType = unknown, Keys extends string = string> {
    result: MultiRetrievalResponse<ValueType>;
    errors: MultiGetError<Keys>[];
}
export interface MultiCasRetrievalWithErrorsResponse<ValueType = unknown, Keys extends string = string> {
    result: MultiCasRetrievalResponse<ValueType>;
    errors: MultiGetError<Keys>[];
}
declare type MultiCasRetrieval<ValueType> = ValueType extends MultiCasRetrievalResponse ? ValueType : CasRetrievalCommandResponse<ValueType>;
declare type MultiRetrieval<ValueType> = ValueType extends MultiRetrievalResponse ? ValueType : RetrievalCommandResponse<ValueType>;
declare type MultiMetaRetrieval<ValueType> = ValueType extends MultiMetaRetrievalResponse ? ValueType : MetaRetrievalCommandResponse<ValueType>;
export declare class MemcacheClient extends EventEmitter {
    options: MemcacheClientOptions;
    socketID: number;
    _logger: DefaultLogger;
    _servers: MultiServerManager;
    private _packer;
    private Promise;
    constructor(options: MemcacheClientOptions);
    shutdown(): void;
    send<ValueType>(data: StoreParams | SocketCallback, key: string, options?: CommonCommandOption | ErrorFirstCallback, callback?: ErrorFirstCallback): Promise<ValueType>;
    xsend(data: StoreParams | SocketCallback, key: string, options?: StoreCommandOptions): Promise<unknown>;
    cmd<Response>(data: string, key?: string, options?: CommonCommandOption, callback?: ErrorFirstCallback): Promise<Response>;
    set(key: string, value: StoreParams, options?: StoreCommandOptions | OperationCallback<Error, string[]>, callback?: OperationCallback<Error, string[]>): Promise<string[]>;
    add(key: string, value: StoreParams, options?: StoreCommandOptions | OperationCallback<Error, string[]>, callback?: OperationCallback<Error, string[]>): Promise<string[]>;
    replace(key: string, value: StoreParams, options?: StoreCommandOptions | OperationCallback<Error, string[]>, callback?: OperationCallback<Error, string[]>): Promise<string[]>;
    append(key: string, value: StoreParams, options?: StoreCommandOptions | OperationCallback<Error, string[]>, callback?: OperationCallback<Error, string[]>): Promise<string[]>;
    prepend(key: string, value: StoreParams, options?: StoreCommandOptions | OperationCallback<Error, string[]>, callback?: OperationCallback<Error, string[]>): Promise<string[]>;
    cas(key: string, value: StoreParams, options: CasCommandOptions, callback?: OperationCallback<Error, string[]>): Promise<string[]>;
    delete(key: string, options?: CommonCommandOption | OperationCallback<Error, string[]>, callback?: OperationCallback<Error, string[]>): Promise<string[]>;
    incr(key: string, value: number, options?: StoreCommandOptions | OperationCallback<Error, string>, callback?: OperationCallback<Error, string>): Promise<string>;
    decr(key: string, value: number, options?: StoreCommandOptions | OperationCallback<Error, string>, callback?: OperationCallback<Error, string>): Promise<string>;
    touch(key: string, exptime: string | number, options?: CommonCommandOption | OperationCallback<Error, string[]>, callback?: OperationCallback<Error, string[]>): Promise<string[]>;
    version(callback?: OperationCallback<Error, string[]>): Promise<string[]>;
    versionAll(trackingCallbacks?: {
        beforePing?: (serverKey: string) => void;
        afterPing?: (serverKey: string, error?: Error) => void;
    }, callback?: OperationCallback<Error, Record<string, {
        version?: string[] | null;
        error?: Error;
    }>>): Promise<{
        values: Record<string, {
            version?: string[] | null;
            error?: Error;
        }>;
    }>;
    store(cmd: string, key: string, value: StoreParams, options?: Partial<CasCommandOptions> | OperationCallback<Error, string[]>, callback?: OperationCallback<Error, string[]>): Promise<string[]>;
    get<ValueType>(key: string | string[], options?: StoreCommandOptions | OperationCallback<Error, MultiRetrieval<ValueType>>, callback?: OperationCallback<Error, MultiRetrieval<ValueType>>): Promise<MultiRetrieval<ValueType>>;
    mg<ValueType>(key: string | string[], options?: MetaGetOptions, callback?: OperationCallback<Error, MultiMetaRetrieval<ValueType>>): Promise<MultiMetaRetrieval<ValueType>>;
    gets<ValueType>(key: string | string[], options?: StoreCommandOptions | OperationCallback<Error, MultiCasRetrieval<ValueType>>, callback?: OperationCallback<Error, MultiCasRetrieval<ValueType>>): Promise<MultiCasRetrieval<ValueType>>;
    getsWithErrors<ValueType, Keys extends string = string>(keys: Keys[], options?: StoreCommandOptions): Promise<MultiCasRetrievalWithErrorsResponse<ValueType, Keys>>;
    getWithErrors<ValueType, Keys extends string = string>(keys: Keys[], options?: StoreCommandOptions): Promise<MultiRetrievalWithErrorsResponse<ValueType, Keys>>;
    retrieve<T>(cmd: string, key: string[] | string, options?: StoreCommandOptions | OperationCallback<Error, T>, callback?: ErrorFirstCallback, metaFlags?: string): Promise<T>;
    xretrieve(cmd: string, key: string | string[], options?: StoreCommandOptions, metaFlags?: string): Promise<unknown>;
    _xretrieverByServer(cmd: string, key: string | string[], options?: StoreCommandOptions, metaFlags?: string): Promise<unknown>;
    xretrieveWithErrors<Keys extends string>(cmd: string, keys: Keys[], options?: StoreCommandOptions): Promise<MultiCasRetrievalWithErrorsResponse<unknown, Keys>>;
    _send(conn: MemcacheConnection, data: StoreParams | SocketCallback, options: Partial<CasCommandOptions>): Promise<unknown>;
    _callbackSend(data: StoreParams | SocketCallback, key: string, options?: Partial<CasCommandOptions>, callback?: ErrorFirstCallback): Promise<unknown>;
    _unpackValue(result: PackedData): number | string | Record<string, unknown> | Buffer;
    _parseMeta(cmdTokens: string[]): MetaResult;
}
export {};
