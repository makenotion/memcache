"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemcacheNode = void 0;
const tslib_1 = require("tslib");
/* eslint-disable no-var,no-magic-numbers */
const assert_1 = tslib_1.__importDefault(require("assert"));
const connection_1 = require("./connection");
const otel = tslib_1.__importStar(require("@opentelemetry/api"));
const tracer = otel.trace.getTracer("makenotion/memcache");
class MemcacheNode {
    constructor(client, options) {
        (0, assert_1.default)(options.server, "Must provide options.server");
        (0, assert_1.default)(options.maxConnections, "Must set options.maxConnections");
        (0, assert_1.default)(options.maxConnections > 0, "options.maxConnections must > 0");
        this.options = options;
        this.connections = [];
        this.client = client;
    }
    doCmd(action) {
        var _a;
        // look for idle and ready connection
        let conn = this.connections.find((c) => {
            return c.isReady() && c._cmdQueue.length === 0;
        });
        if (conn) {
            return action(conn);
        }
        // make a new connection
        if (this.connections.length < ((_a = this.options.maxConnections) !== null && _a !== void 0 ? _a : 0)) {
            return tracer.startActiveSpan("electrode_memcache.connect", async (span) => {
                try {
                    span.setAttributes({ server: this.options.server, maxConnections: this.options.maxConnections, connections: this.connections.length });
                    return await this._connect(this.options.server);
                }
                catch (err) {
                    span.recordException(err);
                    span.setStatus({ code: otel.SpanStatusCode.ERROR });
                    throw err;
                }
                finally {
                    span.end();
                }
            }).then(action);
        }
        // look for least busy connection
        var n = Infinity;
        this.connections.forEach((c) => {
            if (c._cmdQueue.length < n) {
                conn = c;
                n = c._cmdQueue.length;
            }
        });
        if (conn.isReady()) {
            return action(conn);
        }
        return conn.waitReady().then(action);
    }
    shutdown() {
        const connections = this.connections;
        this.connections = [];
        connections.forEach((x) => x.shutdown());
    }
    endConnection(conn) {
        this.connections = this.connections.filter((x) => x._id !== conn._id);
    }
    _connect(server) {
        const conn = new connection_1.MemcacheConnection(this.client, this);
        this.connections.push(conn);
        return conn.connect(server);
    }
}
exports.MemcacheNode = MemcacheNode;
//# sourceMappingURL=memcache-node.js.map