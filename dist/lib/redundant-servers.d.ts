import { MemcacheNode } from "./memcache-node";
import { MemcacheClient } from "./client";
import { SingleServerEntry, CommandCallback, MultiServerManager } from "../types";
declare type RedundantServerEntry = SingleServerEntry & {
    exiledTime?: number;
};
export default class RedundantServers implements MultiServerManager {
    client: MemcacheClient;
    _servers: Array<RedundantServerEntry>;
    _exServers: Array<RedundantServerEntry>;
    _nodes: Record<string, MemcacheNode>;
    _config: Record<string, string | boolean | number>;
    _lastRetryTime: number;
    constructor(client: MemcacheClient, server: SingleServerEntry);
    shutdown(): void;
    doCmd(action: CommandCallback, _key: string): void | Promise<unknown>;
    _retryServers(): void;
    _getNode(): MemcacheNode;
    getServerKey(key: string): string;
}
export {};
