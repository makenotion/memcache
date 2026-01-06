import defaults from "./defaults";
import { MemcacheNode } from "./memcache-node";
import { MemcacheClient } from "./client";
import assert from "assert";
import {
ServerConfig,
  SingleServerEntry,
  MultipleServerEntry,
  ServerDefinition,
  CommandCallback,
  ConnectionError,
  MultiServerManager,
} from "../types";
import _defaults from "lodash.defaults";

/* eslint-disable max-statements,no-magic-numbers */

/*
 * Manage a pool of redundant servers
 */

type RedundantServerEntry = SingleServerEntry & { exiledTime?: number };

export default class ConsistentlyHashedServers implements MultiServerManager {
  client: MemcacheClient;
  _servers: Array<RedundantServerEntry>;
  _exServers: Array<RedundantServerEntry>;
  _serversByServerKey: Record<string, RedundantServerEntry>;
  _serverKeys: Array<string>;
  _nodes: Record<string, MemcacheNode>;
  _config: Record<string, string | boolean | number>;
  _lastRetryTime: number = 0;
  _keyToServerHashFunction: (servers: string[], key: string) => string;

  constructor(
    client: MemcacheClient,
    server: ServerDefinition | SingleServerEntry | MultipleServerEntry,
    keyToServerHashFunction: (servers: string[], key: string) => string
  ) {
    this.client = client;
    this._keyToServerHashFunction = keyToServerHashFunction;
    let servers;
    let maxConnections = defaults.MAX_CONNECTIONS;
    let config: ServerConfig = {
      failedServerOutTime: defaults.FAILED_SERVER_OUT_TIME,
      retryFailedServerInterval: defaults.RETRY_FAILED_SERVER_INTERVAL,
      keepLastServer: defaults.KEEP_LAST_SERVER,
    };
    if ("serverEntry" in server) { // server is a ServerDefinition, extract configs and server entry
      config = _defaults({}, server.config, config);
      server = server.serverEntry;
    }
    if ("server" in server) { // server is a SingleServerEntry
      maxConnections = server.maxConnections || defaults.MAX_CONNECTIONS;
      servers = [{ server: server.server, maxConnections }];
    } else if ("servers" in server) { // server is a MultipleServerEntry
      servers = server.servers;
    } else {
      throw new Error("Invalid server definition");
    }

    this._config = config;
    this._servers = servers;
    this._serversByServerKey = {};
    this._serverKeys = [];
    for (const s of servers) {
      this._serversByServerKey[s.server] = s;
      this._serverKeys.push(s.server);
    }
    this._exServers = []; // servers that failed connection
    this._nodes = {};
  }

  shutdown(): void {
    const keys = Object.keys(this._nodes);
    for (let i = 0; i < keys.length; i++) {
      this._nodes[keys[i]].shutdown();
    }
  }

  doCmd(action: CommandCallback, key: string): void | Promise<unknown> {
    if (this._exServers.length > 0) {
      this._retryServers();
    }
    if (this._servers.length === 0) {
      throw new Error("No more valid servers left");
    }
    if (this._servers.length === 1 && this._config.keepLastServer === true) {
      return this._getNode(key).doCmd(action);
    }
    const node = this._getNode(key);
    return (node.doCmd(action) as Promise<void>).catch((err: ConnectionError) => {
      if (!err.connecting) {
        throw err;
      }
      // failed to connect to server, exile it
      const s = node.options.server;
      const _servers = [];
      for (let i = 0; i < this._servers.length; i++) {
        if (s === this._servers[i].server) {
          this._servers[i].exiledTime = Date.now();
          this._exServers.push(this._servers[i]);
        } else {
          _servers.push(this._servers[i]);
        }
      }
      this._servers = _servers;
      return this.doCmd(action, key);
    });
  }

  _retryServers(): void {
    const now = Date.now();
    if (now - this._lastRetryTime < (this._config.retryFailedServerInterval as number)) {
      return;
    }
    this._lastRetryTime = now;
    let i;
    let n = 0;
    for (i = 0; i < this._exServers.length; i++) {
      const es = this._exServers[i];
      if (now - (es.exiledTime ?? 0) >= (this._config.failedServerOutTime as number)) {
        delete es.exiledTime;
        this._servers.push(es);
        n++;
      }
    }
    if (n > 0) {
      this._exServers = this._exServers.filter((x) => x.exiledTime !== undefined);
    }
  }

  _getNode(key: string): MemcacheNode {
    const serverKey = this.getServerKey(key);
    const server = this._serversByServerKey[serverKey];
    if (!server) {
      throw new Error("Server not found");
    }
    let node = this._nodes[server.server];
    if (node) {
      return node;
    }
    node = new MemcacheNode(this.client, server);
    this._nodes[server.server] = node;
    return node;
  }

  getServerKey(key: string): string {
    return this._keyToServerHashFunction(this._serverKeys, key);
  }
}
