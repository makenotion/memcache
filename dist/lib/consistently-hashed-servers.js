"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const defaults_1 = tslib_1.__importDefault(require("./defaults"));
const memcache_node_1 = require("./memcache-node");
const lodash_defaults_1 = tslib_1.__importDefault(require("lodash.defaults"));
class ConsistentlyHashedServers {
    constructor(client, server, keyToServerHashFunction) {
        this._lastRetryTime = 0;
        this.client = client;
        this._keyToServerHashFunction = keyToServerHashFunction;
        let servers;
        let maxConnections = defaults_1.default.MAX_CONNECTIONS;
        let config = {
            failedServerOutTime: defaults_1.default.FAILED_SERVER_OUT_TIME,
            retryFailedServerInterval: defaults_1.default.RETRY_FAILED_SERVER_INTERVAL,
            keepLastServer: defaults_1.default.KEEP_LAST_SERVER,
        };
        if ("serverEntry" in server) { // server is a ServerDefinition, extract configs and server entry
            config = (0, lodash_defaults_1.default)({}, server.config, config);
            server = server.serverEntry;
        }
        if ("server" in server) { // server is a SingleServerEntry
            maxConnections = server.maxConnections || defaults_1.default.MAX_CONNECTIONS;
            servers = [{ server: server.server, maxConnections }];
        }
        else if ("servers" in server) { // server is a MultipleServerEntry
            servers = server.servers;
        }
        else {
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
    shutdown() {
        const keys = Object.keys(this._nodes);
        for (let i = 0; i < keys.length; i++) {
            this._nodes[keys[i]].shutdown();
        }
    }
    doCmd(action, key) {
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
        return node.doCmd(action).catch((err) => {
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
                }
                else {
                    _servers.push(this._servers[i]);
                }
            }
            this._servers = _servers;
            return this.doCmd(action, key);
        });
    }
    _retryServers() {
        var _a;
        const now = Date.now();
        if (now - this._lastRetryTime < this._config.retryFailedServerInterval) {
            return;
        }
        this._lastRetryTime = now;
        let i;
        let n = 0;
        for (i = 0; i < this._exServers.length; i++) {
            const es = this._exServers[i];
            if (now - ((_a = es.exiledTime) !== null && _a !== void 0 ? _a : 0) >= this._config.failedServerOutTime) {
                delete es.exiledTime;
                this._servers.push(es);
                n++;
            }
        }
        if (n > 0) {
            this._exServers = this._exServers.filter((x) => x.exiledTime !== undefined);
        }
    }
    _getNode(key) {
        const serverKey = this.getServerKey(key);
        const server = this._serversByServerKey[serverKey];
        if (!server) {
            throw new Error("Server not found");
        }
        let node = this._nodes[server.server];
        if (node) {
            return node;
        }
        node = new memcache_node_1.MemcacheNode(this.client, server);
        this._nodes[server.server] = node;
        return node;
    }
    getServerKey(key) {
        return this._keyToServerHashFunction(this._serverKeys, key);
    }
}
exports.default = ConsistentlyHashedServers;
//# sourceMappingURL=consistently-hashed-servers.js.map