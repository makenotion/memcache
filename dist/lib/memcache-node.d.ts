import { MemcacheConnection } from "./connection";
import { MemcacheClient } from "./client";
import { SingleServerEntry, CommandCallback } from "../types";
export declare class MemcacheNode {
    options: SingleServerEntry;
    connections: Array<MemcacheConnection>;
    client: MemcacheClient;
    constructor(client: MemcacheClient, options: SingleServerEntry);
    doCmd(action: CommandCallback): void | Promise<unknown>;
    shutdown(): void;
    endConnection(conn: MemcacheConnection): void;
    _connect(server: string): Promise<MemcacheConnection>;
}
