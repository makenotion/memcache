"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemcacheConnection = exports.Status = void 0;
const tslib_1 = require("tslib");
const net_1 = tslib_1.__importDefault(require("net"));
const tls_1 = tslib_1.__importDefault(require("tls"));
const assert_1 = tslib_1.__importDefault(require("assert"));
const optional_require_1 = require("optional-require");
const Promise = (0, optional_require_1.optionalRequire)("bluebird", {
    default: global.Promise,
});
const memcache_parser_1 = require("memcache-parser");
const cmd_actions_1 = tslib_1.__importDefault(require("./cmd-actions"));
const defaults_1 = tslib_1.__importDefault(require("./defaults"));
/* eslint-disable no-bitwise,no-magic-numbers,max-params,no-unused-vars */
/* eslint-disable no-console,camelcase,max-statements,no-var */
exports.Status = {
    INIT: 1,
    CONNECTING: 2,
    READY: 3,
    SHUTDOWN: 4,
};
const StatusStr = {
    [exports.Status.INIT]: "INIT",
    [exports.Status.CONNECTING]: "CONNECTING",
    [exports.Status.READY]: "READY",
    [exports.Status.SHUTDOWN]: "SHUTDOWN",
};
class MemcacheConnection extends memcache_parser_1.MemcacheParser {
    // TODO: still don't know which type client is
    constructor(client, node) {
        super(client._logger);
        this._reset = false;
        this.client = client;
        this.node = node;
        this.socket = undefined;
        this._cmdQueue = [];
        this._connectPromise = undefined;
        this._id = client.socketID++;
        this._checkCmdTimer = undefined;
        this._cmdTimeout = (client.options && client.options.cmdTimeout) || defaults_1.default.CMD_TIMEOUT_MS;
        (0, assert_1.default)(this._cmdTimeout > 0, "cmdTimeout must be > 0");
        this._cmdCheckInterval = Math.min(250, Math.ceil(this._cmdTimeout / 4));
        this._cmdCheckInterval = Math.max(50, this._cmdCheckInterval);
        this._status = exports.Status.INIT;
    }
    waitDangleSocket(socket) {
        if (!socket)
            return;
        const client = this.client;
        client === null || client === void 0 ? void 0 : client.emit("dangle-wait", { type: "wait", socket });
        const dangleWaitTimeout = setTimeout(() => {
            socket.removeAllListeners("error");
            socket.removeAllListeners("connect");
            socket.destroy();
            client === null || client === void 0 ? void 0 : client.emit("dangle-wait", { type: "timeout" });
        }, (client === null || client === void 0 ? void 0 : client.options.dangleSocketWaitTimeout) || defaults_1.default.DANGLE_SOCKET_WAIT_TIMEOUT);
        socket.once("error", (err) => {
            clearTimeout(dangleWaitTimeout);
            socket.destroy();
            client === null || client === void 0 ? void 0 : client.emit("dangle-wait", { type: "error", err });
        });
    }
    connect(server) {
        var _a, _b;
        const serverStringArray = server.split(":");
        const host = serverStringArray[0];
        const port = +serverStringArray[1];
        (0, assert_1.default)(host, "Must provide server hostname");
        (0, assert_1.default)(typeof port === "number" && port > 0, "Must provide valid server port");
        let socket;
        if (((_b = (_a = this.client) === null || _a === void 0 ? void 0 : _a.options) === null || _b === void 0 ? void 0 : _b.tls) !== undefined) {
            // Create a TLS connection
            socket = tls_1.default.connect({
                host: host,
                port: port,
                ...this.client.options.tls,
            });
        }
        else {
            // Create a regular TCP connection
            socket = net_1.default.createConnection({ host, port });
        }
        this._connectPromise = new Promise((resolve, reject) => {
            this._status = exports.Status.CONNECTING;
            const selfTimeout = () => {
                var _a, _b, _c, _d;
                if (!(((_c = (_b = (_a = this.client) === null || _a === void 0 ? void 0 : _a.options) === null || _b === void 0 ? void 0 : _b.connectTimeout) !== null && _c !== void 0 ? _c : 0) > 0))
                    return undefined;
                return setTimeout(() => {
                    var _a, _b;
                    socket.removeAllListeners("error");
                    socket.removeAllListeners("connect");
                    (_a = this.client) === null || _a === void 0 ? void 0 : _a.emit("timeout", {
                        socket,
                        keepDangleSocket: this.client.options.keepDangleSocket,
                    });
                    if ((_b = this.client) === null || _b === void 0 ? void 0 : _b.options.keepDangleSocket) {
                        this.waitDangleSocket(socket);
                        this._shutdown("connect timeout", true);
                    }
                    else {
                        this._shutdown("connect timeout");
                    }
                    const err = new Error("connect timeout");
                    err.connecting = true;
                    reject(err);
                }, (_d = this.client) === null || _d === void 0 ? void 0 : _d.options.connectTimeout);
            };
            const connTimeout = selfTimeout();
            socket.once("error", (err) => {
                this._shutdown("connect failed");
                if (connTimeout) {
                    clearTimeout(connTimeout);
                }
                err.connecting = true;
                reject(err);
            });
            socket.once("connect", () => {
                this.socket = socket;
                this._status = exports.Status.READY;
                this._connectPromise = undefined;
                socket.removeAllListeners("error");
                this._setupConnection(socket);
                if (connTimeout) {
                    clearTimeout(connTimeout);
                }
                resolve(this);
            });
            this.socket = socket;
        });
        return this._connectPromise;
    }
    isReady() {
        return this._status === exports.Status.READY;
    }
    isConnecting() {
        return this._status === exports.Status.CONNECTING;
    }
    isShutdown() {
        return this._status === exports.Status.SHUTDOWN;
    }
    getStatusStr() {
        return StatusStr[this._status] || "UNKNOWN";
    }
    waitReady() {
        if (this.isConnecting()) {
            (0, assert_1.default)(this._connectPromise, "MemcacheConnection not pending connect");
            return this._connectPromise;
        }
        else if (this.isReady()) {
            return Promise.resolve(this);
        }
        else {
            throw new Error(`MemcacheConnection can't waitReady for status ${this.getStatusStr()}`);
        }
    }
    queueCommand(context) {
        context.queuedTime = Date.now();
        this._startCmdTimeout();
        this._cmdQueue.unshift(context);
    }
    dequeueCommand() {
        if (this.isShutdown()) {
            return { callback: () => undefined };
        }
        return this._cmdQueue.pop();
    }
    peekCommand() {
        return this._cmdQueue[this._cmdQueue.length - 1];
    }
    processCmd(cmdTokens) {
        const action = cmd_actions_1.default[cmdTokens[0]];
        return this[`cmdAction_${action}`](cmdTokens);
    }
    _processMetaItem(token, metadata) {
        switch (token[0]) {
            case "f":
                metadata.flags = +token.slice(1);
                break;
            case "k":
                metadata.key = token.slice(1);
                break;
            case "h":
                metadata.hasBeenHit = token[1] === "1";
                break;
            case "l":
                metadata.secondsSinceLastAccess = +token.slice(1);
                break;
            case "O":
                metadata.opaqueValue = token.slice(1);
                break;
            case "c":
                metadata.casUniq = token.slice(1);
                break;
            case "t":
                metadata.remainingTtl = +token.slice(1);
                break;
            case "W":
                metadata.wonRecache = true;
                break;
            case "Z":
                metadata.wonRecache = false;
                break;
            case "X":
                metadata.stale = true;
                break;
        }
    }
    _processMetaResult(pending) {
        const metadata = {};
        for (const token of pending.cmdTokens) {
            this._processMetaItem(token, metadata);
        }
        return metadata;
    }
    receiveResult(pending) {
        var _a, _b, _c, _d, _e;
        if (this.isReady()) {
            const retrieve = this.peekCommand();
            if (pending.cmdTokens[0] === "VA" || pending.cmdTokens[0] === "HD") {
                // search for key in response, which is only set for multi requests. use the pending key otherwise
                const key = (retrieve.expectedResponses || 1) === 1
                    ? pending.key
                    : ((_a = pending.cmdTokens.find((token) => token.startsWith("k"))) === null || _a === void 0 ? void 0 : _a.slice(1)) || pending.key;
                // handle meta command responses
                const metadata = (_b = this.client) === null || _b === void 0 ? void 0 : _b._parseMeta(pending.cmdTokens);
                const dataSize = +pending.cmdTokens[1];
                retrieve.results[key] = {
                    type: pending.cmdTokens[0],
                    flags: metadata === null || metadata === void 0 ? void 0 : metadata.flags,
                    value: dataSize > 0
                        ? (_c = this.client) === null || _c === void 0 ? void 0 : _c._unpackValue({
                            ...pending,
                            flag: metadata === null || metadata === void 0 ? void 0 : metadata.flags,
                        })
                        : undefined,
                    ...metadata,
                };
                // for pipelined multi mg, there is no "EN" to tell us when all responses are received
                // instead, we track completion based on the expected number of responses and dequeue when reached
                if (Object.keys(retrieve.results).length >= (retrieve.expectedResponses || 1)) {
                    (_d = this.dequeueCommand()) === null || _d === void 0 ? void 0 : _d.callback();
                }
            }
            else {
                try {
                    retrieve.results[pending.cmdTokens[1]] = {
                        tokens: pending.cmdTokens,
                        casUniq: pending.cmdTokens[4],
                        value: (_e = this.client) === null || _e === void 0 ? void 0 : _e._unpackValue(pending),
                    };
                }
                catch (err) {
                    retrieve.error = err;
                }
            }
        }
        delete pending.data;
    }
    shutdown() {
        this._shutdown("Shutdown requested");
    }
    //
    // Internal methods
    //
    cmdAction_OK(cmdTokens) {
        var _a;
        (_a = this.dequeueCommand()) === null || _a === void 0 ? void 0 : _a.callback(null, cmdTokens);
    }
    cmdAction_ERROR(cmdTokens) {
        var _a;
        const msg = (m) => (m ? ` ${m}` : "");
        const error = new Error(`${cmdTokens[0]}${msg(cmdTokens.slice(1).join(" "))}`);
        error.cmdTokens = cmdTokens;
        (_a = this.dequeueCommand()) === null || _a === void 0 ? void 0 : _a.callback(error);
    }
    cmdAction_RESULT(cmdTokens) {
        if (this.isReady() && cmdTokens) {
            const retrieve = this.peekCommand();
            const cmd = cmdTokens[0];
            const results = retrieve.results;
            if (!results[cmd]) {
                results[cmd] = [];
            }
            results[cmd].push(cmdTokens.slice(1));
        }
    }
    cmdAction_SINGLE_RESULT(cmdTokens) {
        this.cmdAction_OK(cmdTokens);
    }
    cmdAction_SELF(cmdTokens) {
        this[`cmd_${cmdTokens[0]}`](cmdTokens);
    }
    cmdAction_undefined(cmdTokens) {
        var _a;
        // incr/decr response
        // - <value>\r\n , where <value> is the new value of the item's data,
        //   after the increment/decrement operation was carried out.
        if (cmdTokens.length === 1 && cmdTokens[0].match(/[+-]?[0-9]+/)) {
            (_a = this.dequeueCommand()) === null || _a === void 0 ? void 0 : _a.callback(null, cmdTokens[0]);
            return true;
        }
        else {
            console.log("No command action defined for", cmdTokens);
        }
        return false;
    }
    cmd_VALUE(cmdTokens) {
        this.initiatePending(cmdTokens, +cmdTokens[3]);
    }
    cmd_VA(cmdTokens) {
        this.initiatePending(cmdTokens, +cmdTokens[1]);
    }
    // eslint-disable-next-line
    cmd_EN(_cmdTokens) {
        var _a;
        (_a = this.dequeueCommand()) === null || _a === void 0 ? void 0 : _a.callback();
    }
    // eslint-disable-next-line
    cmd_END(_cmdTokens) {
        var _a;
        (_a = this.dequeueCommand()) === null || _a === void 0 ? void 0 : _a.callback();
    }
    _shutdown(msg, keepSocket) {
        var _a;
        if (this.isShutdown()) {
            return;
        }
        delete this._connectPromise;
        let cmd;
        while ((cmd = this.dequeueCommand())) {
            cmd.callback(new Error(msg));
        }
        this._status = exports.Status.SHUTDOWN;
        // reset connection
        (_a = this.node) === null || _a === void 0 ? void 0 : _a.endConnection(this);
        if (this.socket) {
            this.socket.end();
            if (!keepSocket)
                this.socket.destroy();
            this.socket.unref();
        }
        delete this.socket;
        delete this.client;
        delete this.node;
    }
    _checkCmdTimeout() {
        this._checkCmdTimer = undefined;
        if (this._cmdQueue.length > 0) {
            const cmd = this.peekCommand();
            const now = Date.now();
            if (now - cmd.queuedTime > this._cmdTimeout) {
                this._shutdown("Command timeout");
            }
            else {
                this._startCmdTimeout();
            }
        }
    }
    _startCmdTimeout() {
        if (!this._checkCmdTimer) {
            this._checkCmdTimer = setTimeout(this._checkCmdTimeout.bind(this), this._cmdCheckInterval);
        }
    }
    _setupConnection(socket) {
        var _a, _b, _c, _d;
        const keepAlive = (_b = (_a = this.client) === null || _a === void 0 ? void 0 : _a.options) === null || _b === void 0 ? void 0 : _b.keepAlive;
        if (keepAlive !== false) {
            const initialDelay = typeof keepAlive === "number" && Number.isFinite(keepAlive) ? keepAlive : 60000;
            socket.setKeepAlive(true, initialDelay);
        }
        if ((_d = (_c = this.client) === null || _c === void 0 ? void 0 : _c.options) === null || _d === void 0 ? void 0 : _d.noDelay) {
            socket.setNoDelay(true);
        }
        socket.on("data", this.onData.bind(this));
        socket.on("end", () => {
            this._shutdown("socket end");
        });
        socket.on("error", (err) => {
            this._shutdown(`socket error ${err.message}`);
        });
        socket.on("close", () => {
            this._shutdown("socket close");
        });
        socket.on("timeout", () => {
            this._shutdown("socket timeout");
        });
    }
}
exports.MemcacheConnection = MemcacheConnection;
MemcacheConnection.Status = exports.Status;
//# sourceMappingURL=connection.js.map