"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemcacheClient = void 0;
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const optional_require_1 = require("optional-require");
const Zstd = (0, optional_require_1.optionalRequire)("zstd.ts");
const nodeify_1 = tslib_1.__importDefault(require("./nodeify"));
const value_packer_1 = tslib_1.__importDefault(require("./value-packer"));
const null_logger_1 = tslib_1.__importDefault(require("./null-logger"));
const defaults_1 = tslib_1.__importDefault(require("./defaults"));
const redundant_servers_1 = tslib_1.__importDefault(require("./redundant-servers"));
const events_1 = tslib_1.__importDefault(require("events"));
const consistently_hashed_servers_1 = tslib_1.__importDefault(require("./consistently-hashed-servers"));
class MemcacheClient extends events_1.default {
    constructor(options) {
        super();
        (0, assert_1.default)(options.server, "Must provide options.server");
        this.options = options;
        this.socketID = 1;
        this._packer = new value_packer_1.default(options.compressor || Zstd, options.assumeBuffer || false);
        this._logger = options.logger !== undefined ? options.logger : null_logger_1.default;
        this.options.cmdTimeout = options.cmdTimeout || defaults_1.default.CMD_TIMEOUT_MS;
        if (options.keyToServerHashFunction) {
            this._servers = new consistently_hashed_servers_1.default(this, options.server, options.keyToServerHashFunction);
        }
        else {
            this._servers = new redundant_servers_1.default(this, options.server);
        }
        this.Promise = options.Promise || Promise;
    }
    shutdown() {
        this._servers.shutdown();
    }
    //
    // Allows you to send any arbitrary data you want to the server.
    // You are responsible for making sure the data contains properly
    // formed memcached ASCII protocol commands and data.
    // Any responses from the server will be parsed by the client
    // and returned as best as it could.
    //
    // If data is a function, then it will be called with socket which you can
    // use to write any data you want else it will be passed to socket.write.
    //
    // DO NOT send multiple commands in a single call.  Bad things will happen.
    //
    // Set options.noreply if you want to fire and forget.  Note that this
    // doesn't apply if you send a command like get/gets/stats, which don't
    // have the noreply option.
    //
    send(data, key, options, callback) {
        if (typeof options === "function") {
            callback = options;
            options = {};
        }
        else if (options === undefined) {
            options = {};
        }
        return this._callbackSend(data, key, options, callback);
    }
    // the promise only version of send
    xsend(data, key, options) {
        return this._servers.doCmd((c) => this._send(c, data, options || {}), key);
    }
    // a convenient method to send a single line as a command to the server
    // with \r\n appended for you automatically
    cmd(data, key, options, callback) {
        return this.send((socket) => {
            let line = data;
            if (options === null || options === void 0 ? void 0 : options.noreply) {
                line += " noreply";
            }
            socket === null || socket === void 0 ? void 0 : socket.write(`${line}\r\n`);
        }, key || "", options, callback);
    }
    // "set" means "store this data".
    set(key, value, options, callback) {
        options = options || {};
        if (options.ignoreNotStored === undefined) {
            options.ignoreNotStored = this.options.ignoreNotStored;
        }
        // it's tricky to threat optional object as callback
        return this.store("set", key, value, options, callback);
    }
    // "add" means "store this data, but only if the server *doesn't* already
    // hold data for this key".
    add(key, value, options, callback) {
        return this.store("add", key, value, options, callback);
    }
    // "replace" means "store this data, but only if the server *does*
    // already hold data for this key".
    replace(key, value, options, callback) {
        return this.store("replace", key, value, options, callback);
    }
    // "append" means "add this data to an existing key after existing data".
    append(key, value, options, callback) {
        return this.store("append", key, value, options, callback);
    }
    // "prepend" means "add this data to an existing key before existing data".
    prepend(key, value, options, callback) {
        return this.store("prepend", key, value, options, callback);
    }
    // "cas" is a check and set operation which means "store this data but
    // only if no one else has updated since I last fetched it."
    //
    // cas unique must be passed in options.casUniq
    //
    cas(key, value, options, callback) {
        (0, assert_1.default)(options === null || options === void 0 ? void 0 : options.casUniq, "Must provide options.casUniq for cas store command");
        return this.store("cas", key, value, options, callback);
    }
    // delete key, fire & forget with options.noreply
    delete(key, options, callback) {
        return this.cmd(`delete ${key}`, key, options, callback);
    }
    // incr key by value, fire & forget with options.noreply
    incr(key, value, options, callback) {
        return this.cmd(`incr ${key} ${value}`, key, options, callback);
    }
    // decrease key by value, fire & forget with options.noreply
    decr(key, value, options, callback) {
        return this.cmd(`decr ${key} ${value}`, key, options, callback);
    }
    // touch key with exp time, fire & forget with options.noreply
    touch(key, exptime, options, callback) {
        return this.cmd(`touch ${key} ${exptime}`, key, options, callback);
    }
    // get version of server
    version(callback) {
        return this.cmd(`version`, "", {}, callback);
    }
    async versionAll(trackingCallbacks, callback) {
        const versionObjects = await Promise.all(this._servers._servers.map(async (server) => {
            var _a, _b, _c;
            (_a = trackingCallbacks === null || trackingCallbacks === void 0 ? void 0 : trackingCallbacks.beforePing) === null || _a === void 0 ? void 0 : _a.call(trackingCallbacks, server.server);
            try {
                const response = await this.cmd(`version`, server.server, {}, callback);
                (_b = trackingCallbacks === null || trackingCallbacks === void 0 ? void 0 : trackingCallbacks.afterPing) === null || _b === void 0 ? void 0 : _b.call(trackingCallbacks, server.server, undefined);
                return { server: server.server, value: { version: response } };
            }
            catch (error) {
                (_c = trackingCallbacks === null || trackingCallbacks === void 0 ? void 0 : trackingCallbacks.afterPing) === null || _c === void 0 ? void 0 : _c.call(trackingCallbacks, server.server, error);
                return { server: server.server, value: { error: error } };
            }
        }));
        const values = versionObjects.reduce((accumulator, versionObject) => {
            accumulator[versionObject.server] = versionObject.value;
            return accumulator;
        }, {});
        return { values };
    }
    // a generic API for issuing one of the store commands
    store(cmd, key, value, options, callback) {
        if (typeof options === "function") {
            callback = options;
            options = {};
        }
        else if (options === undefined) {
            options = {};
        }
        const lifetime = options.lifetime !== undefined ? options.lifetime : this.options.lifetime || 60;
        const casUniq = options.casUniq ? ` ${options.casUniq}` : "";
        const noreply = options.noreply ? ` noreply` : "";
        //
        // store commands
        // <command name> <key> <flags> <exptime> <bytes> [noreply]\r\n
        //
        const _data = (socket) => {
            const packed = this._packer.pack(value, (options === null || options === void 0 ? void 0 : options.compress) === true);
            const bytes = Buffer.byteLength(packed.data);
            socket === null || socket === void 0 ? void 0 : socket.write(Buffer.concat([
                Buffer.from(`${cmd} ${key} ${packed.flag} ${lifetime} ${bytes}${casUniq}${noreply}\r\n`),
                Buffer.isBuffer(packed.data) ? packed.data : Buffer.from(packed.data),
                Buffer.from("\r\n"),
            ]));
        };
        return this._callbackSend(_data, key, options, callback);
    }
    get(key, options, callback) {
        return this.retrieve("get", key, options, callback);
    }
    mg(key, options, callback) {
        // always request value and flags
        // key is only requested when there is an array to identify the responses by key
        let metaFlags = Array.isArray(key) ? "v k f" : "v f";
        if (options === null || options === void 0 ? void 0 : options.keyAsBase64) {
            metaFlags += " b";
        }
        if (options === null || options === void 0 ? void 0 : options.includeCasToken) {
            metaFlags += " c";
        }
        if (options === null || options === void 0 ? void 0 : options.includeHasBeenHit) {
            metaFlags += " h";
        }
        if (options === null || options === void 0 ? void 0 : options.includeLastAccessed) {
            metaFlags += " l";
        }
        if (options === null || options === void 0 ? void 0 : options.includeRemainingTtl) {
            metaFlags += " t";
        }
        if (options === null || options === void 0 ? void 0 : options.dontBumpLru) {
            metaFlags += " n";
        }
        if (options === null || options === void 0 ? void 0 : options.vivifyOnMiss) {
            metaFlags += ` N${options.vivifyOnMiss}`;
        }
        if (options === null || options === void 0 ? void 0 : options.noreply) {
            metaFlags += " q";
        }
        return this.retrieve("mg", key, options, callback, metaFlags);
    }
    gets(key, options, callback) {
        return this.retrieve("gets", key, options, callback);
    }
    // Like gets, but catches errors per-server instead of failing fast.
    // Returns partial results along with error information for failed servers.
    getsWithErrors(keys, options) {
        return this.xretrieveWithErrors("gets", keys, options);
    }
    // Like get, but catches errors per-server instead of failing fast.
    // Returns partial results along with error information for failed servers.
    getWithErrors(keys, options) {
        return this.xretrieveWithErrors("get", keys, options);
    }
    // A generic API for issuing get or gets command
    retrieve(cmd, key, options, callback, metaFlags) {
        if (typeof options === "function") {
            callback = options;
            options = {};
        }
        return (0, nodeify_1.default)(this.xretrieve(cmd, key, options, metaFlags), callback);
    }
    // the promise only version of retrieve
    xretrieve(cmd, key, options, metaFlags) {
        var _a;
        // split into requests by consistently hashed server if necessary
        const serverManager = this._servers;
        if (serverManager instanceof consistently_hashed_servers_1.default && Array.isArray(key)) {
            const serverKeys = new Map();
            for (const k of key) {
                const serverKey = serverManager.getServerKey(k);
                if (!serverKeys.has(serverKey)) {
                    serverKeys.set(serverKey, []);
                }
                (_a = serverKeys.get(serverKey)) === null || _a === void 0 ? void 0 : _a.push(k);
            }
            return Promise.all(Array.from(serverKeys.values()).map((keys) => this._xretrieverByServer(cmd, keys, options, metaFlags)));
        }
        return this._xretrieverByServer(cmd, key, options, metaFlags);
    }
    // retrieve one or more keys from a single server
    _xretrieverByServer(cmd, key, options, metaFlags) {
        //
        // get <key>*\r\n
        // gets <key>*\r\n
        // mg <key> <flags>\r\n
        //
        // - <key>* means one or more key strings separated by whitespace.
        //
        if (metaFlags) {
            // sending multiple keys works differently for meta protocol
            // e.g. "mg foo v\r\nmg bar v\r\nmg baz v\r\n" instead of "mg foo bar baz v\r\n"
            return Array.isArray(key)
                ? this.xsend(key.map((k) => `${cmd} ${k} ${metaFlags}\r\n`).join(""), key[0], {
                    ...options,
                    expectedResponses: key.length,
                })
                : this.xsend(`${cmd} ${key} ${metaFlags}\r\n`, key, options).then((r) => Object.values(r).shift());
        }
        return Array.isArray(key)
            ? // NOTE: can't do this for meta commands, instead do "mg foo v\r\nmg bar v\r\nmg baz v\r\n"
                this.xsend(`${cmd} ${key.join(" ")}\r\n`, key[0], options)
            : this.xsend(`${cmd} ${key}\r\n`, key, options).then((r) => r[key]);
    }
    // the promise only version of retrieve that catches errors per-server
    // instead of failing fast, allowing partial results to be returned
    async xretrieveWithErrors(cmd, keys, options) {
        var _a;
        const serverManager = this._servers;
        // If not using consistently hashed servers, just do a single request
        if (!(serverManager instanceof consistently_hashed_servers_1.default)) {
            try {
                const result = await this._xretrieverByServer(cmd, keys, options);
                return { result: result, errors: [] };
            }
            catch (error) {
                return {
                    result: {},
                    errors: [{ error: error, serverKey: "", keys }],
                };
            }
        }
        // Group keys by server
        const serverKeysMap = new Map();
        for (const k of keys) {
            const serverKey = serverManager.getServerKey(k);
            if (!serverKeysMap.has(serverKey)) {
                serverKeysMap.set(serverKey, []);
            }
            (_a = serverKeysMap.get(serverKey)) === null || _a === void 0 ? void 0 : _a.push(k);
        }
        const errors = [];
        const results = await Promise.all(Array.from(serverKeysMap.entries()).map(async ([serverKey, serverKeys]) => {
            try {
                return await this._xretrieverByServer(cmd, serverKeys, options);
            }
            catch (error) {
                errors.push({
                    error: error,
                    serverKey,
                    keys: serverKeys,
                });
            }
        }));
        return { result: Object.assign({}, ...results), errors };
    }
    //
    // Internal methods
    //
    _send(conn, data, options) {
        var _a;
        try {
            // send data to connection
            if (typeof data === "function") {
                data(conn.socket);
            }
            else {
                (_a = conn.socket) === null || _a === void 0 ? void 0 : _a.write(data);
            }
            // if no reply wanted then just return
            if (options.noreply) {
                return this.Promise.resolve();
            }
            // queue up context to listen for reply
            return new this.Promise((resolve, reject) => {
                const context = {
                    error: null,
                    results: {},
                    expectedResponses: options.expectedResponses || 1,
                    callback: (err, result) => {
                        if (err) {
                            if (options.ignoreNotStored === true && err.message === "NOT_STORED") {
                                return resolve("ignore NOT_STORED");
                            }
                            return reject(err);
                        }
                        if (result) {
                            return resolve(result);
                        }
                        else if (context.error) {
                            return reject(context.error);
                        }
                        else {
                            return resolve(context.results);
                        }
                    },
                };
                conn.queueCommand(context);
            });
        }
        catch (err) {
            return this.Promise.reject(err);
        }
    }
    // internal send that expects all params passed (even if they are undefined)
    _callbackSend(data, key, options, callback) {
        return (0, nodeify_1.default)(this.xsend(data, key, options), callback);
    }
    _unpackValue(result) {
        //
        // VALUE <key> <flags> <bytes> [<cas unique>]\r\n
        //
        // If flag is already set (from meta command parsing), use it; otherwise, use cmdTokens[2] (classic get)
        if (typeof result.flag !== "number" || isNaN(result.flag)) {
            result.flag = +result.cmdTokens[2];
        }
        return this._packer.unpack(result);
    }
    // eslint-disable-next-line complexity
    _parseMeta(cmdTokens) {
        // example input:
        // ["VA", "<flag><value>*", "<flag2><value2>*"]
        const metadata = {};
        for (const token of cmdTokens) {
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
        return metadata;
    }
}
exports.MemcacheClient = MemcacheClient;
//# sourceMappingURL=client.js.map