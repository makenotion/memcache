import { MemcacheNode } from "./memcache-node";
import { MemcacheClient } from "./client";
import { SingleServerEntry, MultipleServerEntry, ServerDefinition, CommandCallback, MultiServerManager } from "../types";
declare type RedundantServerEntry = SingleServerEntry & {
    exiledTime?: number;
};
export default class ConsistentlyHashedServers implements MultiServerManager {
    client: MemcacheClient;
    _servers: Array<RedundantServerEntry>;
    _exServers: Array<RedundantServerEntry>;
    _serversByServerKey: Record<string, RedundantServerEntry>;
    _serverKeys: Array<string>;
    _nodes: Record<string, MemcacheNode>;
    _config: Record<string, string | boolean | number>;
    _lastRetryTime: number;
    _keyToServerHashFunction: (servers: string[], key: string) => string;
    constructor(client: MemcacheClient, server: ServerDefinition | SingleServerEntry | MultipleServerEntry, keyToServerHashFunction: (servers: string[], key: string) => string);
    shutdown(): void;
    doCmd(action: CommandCallback, key: string): void | Promise<unknown>;
    _retryServers(): void;
    _getNode(key: string): MemcacheNode;
    getServerKey(key: string): string;
}
export {};
