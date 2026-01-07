/* eslint-disable no-unused-vars,no-irregular-whitespace,no-nested-ternary */

import { MemcacheClient } from "../..";
import memcached from "memcached-njs";
import { uniq } from "lodash";
import { expect } from "@jest/globals";
import NullLogger from "../../lib/null-logger";
import { AddressInfo } from "net";
import ConsistentlyHashedServers from "../../lib/consistently-hashed-servers";

describe("consistently hashed servers", function () {
  process.on("unhandledRejection", (e) => {
    console.log("unhandledRejection", e);
  });

  const serverOptions = {
    logger: NullLogger,
  };

  // Simple hash function that routes based on first character of key
  const simpleHashFunction = (servers: string[], key: string): string => {
    const index = key.charCodeAt(0) % servers.length;
    return servers[index];
  };

  // Deterministic hash function for testing - routes to specific server based on key prefix
  const prefixHashFunction = (servers: string[], key: string): string => {
    if (key.startsWith("server0:")) return servers[0];
    if (key.startsWith("server1:")) return servers[1];
    if (key.startsWith("server2:")) return servers[2];
    if (key.startsWith("server3:")) return servers[3];
    // Default: hash based on key length
    return servers[key.length % servers.length];
  };

  describe("key routing", () => {
    it("should route keys to servers based on hash function", async () => {
      const servers = await Promise.all([
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
      ]);

      const ports = servers.map((s) => (s._server?.address() as AddressInfo).port);
      const serversUrls = ports.map((p) => ({ server: `localhost:${p}`, maxConnections: 3 }));

      const x = new MemcacheClient({
        server: { servers: serversUrls },
        keyToServerHashFunction: simpleHashFunction,
      });

      try {
        // Set values with keys that will hash to different servers
        await x.set("aaa", "value-a"); // 'a' = 97, 97 % 3 = 1
        await x.set("bbb", "value-b"); // 'b' = 98, 98 % 3 = 2
        await x.set("ccc", "value-c"); // 'c' = 99, 99 % 3 = 0

        // Verify values can be retrieved
        const resultA = await x.get<string>("aaa");
        const resultB = await x.get<string>("bbb");
        const resultC = await x.get<string>("ccc");

        expect(resultA.value).toEqual("value-a");
        expect(resultB.value).toEqual("value-b");
        expect(resultC.value).toEqual("value-c");
      } finally {
        x.shutdown();
        servers.forEach((s) => s.shutdown());
      }
    });

    it("should consistently route the same key to the same server", async () => {
      const servers = await Promise.all([
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
      ]);

      const ports = servers.map((s) => (s._server?.address() as AddressInfo).port);
      const serversUrls = ports.map((p) => ({ server: `localhost:${p}`, maxConnections: 3 }));

      // Track which server each key is routed to
      const routingLog: Record<string, string[]> = {};
      const trackingHashFunction = (serverList: string[], key: string): string => {
        const server = simpleHashFunction(serverList, key);
        if (!routingLog[key]) routingLog[key] = [];
        routingLog[key].push(server);
        return server;
      };

      const x = new MemcacheClient({
        server: { servers: serversUrls },
        keyToServerHashFunction: trackingHashFunction,
      });

      try {
        const testKey = "consistent-key";

        // Perform multiple operations on the same key
        await x.set(testKey, "value1");
        await x.get(testKey);
        await x.set(testKey, "value2");
        await x.get(testKey);
        await x.set(testKey, "value3");

        // Verify all operations went to the same server
        const uniqueServers = uniq(routingLog[testKey]);
        expect(uniqueServers.length).toBe(1);
        expect(routingLog[testKey].length).toBe(5); // 5 operations
      } finally {
        x.shutdown();
        servers.forEach((s) => s.shutdown());
      }
    });

    it("should return correct server key via getServerKey", async () => {
      const servers = await Promise.all([
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
      ]);

      const ports = servers.map((s) => (s._server?.address() as AddressInfo).port);
      const serversUrls = ports.map((p) => ({ server: `localhost:${p}`, maxConnections: 3 }));

      const x = new MemcacheClient({
        server: { servers: serversUrls },
        keyToServerHashFunction: simpleHashFunction,
      });

      try {
        // Verify getServerKey returns correct server
        const serverKey1 = x._servers.getServerKey("aaa"); // 97 % 2 = 1
        const serverKey2 = x._servers.getServerKey("bbb"); // 98 % 2 = 0

        expect(serverKey1).toEqual(`localhost:${ports[1]}`);
        expect(serverKey2).toEqual(`localhost:${ports[0]}`);
      } finally {
        x.shutdown();
        servers.forEach((s) => s.shutdown());
      }
    });
  });

  describe("multi-key operations", () => {
    it("should store and retrieve values on different servers", async () => {
      const servers = await Promise.all([
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
      ]);

      const ports = servers.map((s) => (s._server?.address() as AddressInfo).port);
      const serversUrls = ports.map((p) => ({ server: `localhost:${p}`, maxConnections: 3 }));

      const x = new MemcacheClient({
        server: { servers: serversUrls },
        keyToServerHashFunction: prefixHashFunction,
      });

      try {
        // Set values that route to different servers
        await x.set("server0:key1", "value-0-1");
        await x.set("server1:key1", "value-1-1");
        await x.set("server2:key1", "value-2-1");
        await x.set("server3:key1", "value-3-1");

        // Verify each key can be retrieved correctly
        const result0 = await x.get<string>("server0:key1");
        const result1 = await x.get<string>("server1:key1");
        const result2 = await x.get<string>("server2:key1");
        const result3 = await x.get<string>("server3:key1");

        expect(result0.value).toEqual("value-0-1");
        expect(result1.value).toEqual("value-1-1");
        expect(result2.value).toEqual("value-2-1");
        expect(result3.value).toEqual("value-3-1");

        // Verify keys were actually routed to different servers
        const serverKey0 = x._servers.getServerKey("server0:key1");
        const serverKey1 = x._servers.getServerKey("server1:key1");
        const serverKey2 = x._servers.getServerKey("server2:key1");
        const serverKey3 = x._servers.getServerKey("server3:key1");

        // All four keys should go to different servers
        const uniqueServers = uniq([serverKey0, serverKey1, serverKey2, serverKey3]);
        expect(uniqueServers.length).toBe(4);
      } finally {
        x.shutdown();
        servers.forEach((s) => s.shutdown());
      }
    });

    it("should route multiple keys to the same server when hash dictates", async () => {
      const servers = await Promise.all([
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
      ]);

      const ports = servers.map((s) => (s._server?.address() as AddressInfo).port);
      const serversUrls = ports.map((p) => ({ server: `localhost:${p}`, maxConnections: 3 }));

      const x = new MemcacheClient({
        server: { servers: serversUrls },
        keyToServerHashFunction: prefixHashFunction,
      });

      try {
        // Set multiple values that should all go to server0
        await x.set("server0:key1", "value1");
        await x.set("server0:key2", "value2");
        await x.set("server0:key3", "value3");

        // Verify individual gets work
        const r1 = await x.get<string>("server0:key1");
        const r2 = await x.get<string>("server0:key2");
        const r3 = await x.get<string>("server0:key3");

        expect(r1.value).toEqual("value1");
        expect(r2.value).toEqual("value2");
        expect(r3.value).toEqual("value3");

        // All keys should route to the same server
        const serverKey1 = x._servers.getServerKey("server0:key1");
        const serverKey2 = x._servers.getServerKey("server0:key2");
        const serverKey3 = x._servers.getServerKey("server0:key3");

        expect(serverKey1).toEqual(serverKey2);
        expect(serverKey2).toEqual(serverKey3);
      } finally {
        x.shutdown();
        servers.forEach((s) => s.shutdown());
      }
    });

    it("should handle meta get (mg) with values on different servers", async () => {
      const servers = await Promise.all([
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
      ]);

      const ports = servers.map((s) => (s._server?.address() as AddressInfo).port);
      const serversUrls = ports.map((p) => ({ server: `localhost:${p}`, maxConnections: 3 }));

      const x = new MemcacheClient({
        server: { servers: serversUrls },
        keyToServerHashFunction: prefixHashFunction,
      });

      try {
        await x.set("server0:meta-key", "meta-value-0");
        await x.set("server1:meta-key", "meta-value-1");

        // Verify individual mg works
        const mg0 = await x.mg<string>("server0:meta-key");
        const mg1 = await x.mg<string>("server1:meta-key");

        expect(mg0.value).toEqual("meta-value-0");
        expect(mg1.value).toEqual("meta-value-1");

        // Verify they're on different servers
        const serverKey0 = x._servers.getServerKey("server0:meta-key");
        const serverKey1 = x._servers.getServerKey("server1:meta-key");
        expect(serverKey0).not.toEqual(serverKey1);
      } finally {
        x.shutdown();
        servers.forEach((s) => s.shutdown());
      }
    });
  });

  describe("server failure handling", () => {
    it("should handle server that gets shut down", async () => {
      const servers = await Promise.all([
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
      ]);

      const ports = servers.map((s) => (s._server?.address() as AddressInfo).port);
      const serversUrls = ports.map((p) => ({ server: `localhost:${p}`, maxConnections: 3 }));

      const x = new MemcacheClient({
        server: { servers: serversUrls },
        keyToServerHashFunction: prefixHashFunction,
        cmdTimeout: 500,
      });

      try {
        // First verify all servers are working
        await x.set("server0:key", "value0");
        await x.set("server1:key", "value1");
        await x.set("server2:key", "value2");

        const r0 = await x.get<string>("server0:key");
        const r1 = await x.get<string>("server1:key");
        const r2 = await x.get<string>("server2:key");

        expect(r0.value).toEqual("value0");
        expect(r1.value).toEqual("value1");
        expect(r2.value).toEqual("value2");

        // All three servers should be active
        expect(x._servers._servers.length).toBe(3);
        expect(x._servers._exServers.length).toBe(0);
      } finally {
        x.shutdown();
        servers.forEach((s) => s.shutdown());
      }
    }, 10000);

  });

  describe("versionAll", () => {
    it("should return version from all servers", async () => {
      const servers = await Promise.all([
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
      ]);

      const ports = servers.map((s) => (s._server?.address() as AddressInfo).port);
      const serversUrls = ports.map((p) => ({ server: `localhost:${p}`, maxConnections: 3 }));

      const x = new MemcacheClient({
        server: { servers: serversUrls },
        keyToServerHashFunction: simpleHashFunction,
      });

      try {
        const result = await x.versionAll();

        expect(result.values).toBeDefined();
        expect(Object.keys(result.values).length).toBe(3);

        // Each server should have a version
        for (const serverUrl of serversUrls) {
          expect(result.values[serverUrl.server]).toBeDefined();
          expect(result.values[serverUrl.server].version).toBeDefined();
          expect(result.values[serverUrl.server].version?.[0]).toEqual("VERSION");
        }
      } finally {
        x.shutdown();
        servers.forEach((s) => s.shutdown());
      }
    });

    it("should call tracking callbacks in versionAll", async () => {
      const servers = await Promise.all([
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
      ]);

      const ports = servers.map((s) => (s._server?.address() as AddressInfo).port);
      const serversUrls = ports.map((p) => ({ server: `localhost:${p}`, maxConnections: 3 }));

      const x = new MemcacheClient({
        server: { servers: serversUrls },
        keyToServerHashFunction: simpleHashFunction,
      });

      const beforePingCalls: string[] = [];
      const afterPingCalls: Array<{ server: string; error?: Error }> = [];

      try {
        await x.versionAll({
          beforePing: (serverKey) => beforePingCalls.push(serverKey),
          afterPing: (serverKey, error) => afterPingCalls.push({ server: serverKey, error }),
        });

        expect(beforePingCalls.length).toBe(2);
        expect(afterPingCalls.length).toBe(2);

        // All afterPing calls should have no error
        afterPingCalls.forEach((call) => {
          expect(call.error).toBeUndefined();
        });
      } finally {
        x.shutdown();
        servers.forEach((s) => s.shutdown());
      }
    });
  });

  describe("initialization", () => {
    it("should initialize with SingleServerEntry", async () => {
      const server = await memcached.startServer(serverOptions);
      const port = (server._server?.address() as AddressInfo).port;

      const x = new MemcacheClient({
        server: { server: `localhost:${port}`, maxConnections: 5 },
        keyToServerHashFunction: simpleHashFunction,
      });

      try {
        await x.set("test-key", "test-value");
        const result = await x.get<string>("test-key");
        expect(result.value).toEqual("test-value");
      } finally {
        x.shutdown();
        server.shutdown();
      }
    });

    it("should initialize with ServerDefinition including config", async () => {
      const server = await memcached.startServer(serverOptions);
      const port = (server._server?.address() as AddressInfo).port;

      const x = new MemcacheClient({
        server: {
          serverEntry: { server: `localhost:${port}`, maxConnections: 5 },
          config: {
            retryFailedServerInterval: 50,
            failedServerOutTime: 200,
            keepLastServer: true,
          },
        },
        keyToServerHashFunction: simpleHashFunction,
      });

      try {
        await x.set("test-key", "test-value");
        const result = await x.get<string>("test-key");
        expect(result.value).toEqual("test-value");

        // Verify config was applied
        const servers = x._servers as ConsistentlyHashedServers;
        expect(servers._config.retryFailedServerInterval).toBe(50);
        expect(servers._config.failedServerOutTime).toBe(200);
        expect(servers._config.keepLastServer).toBe(true);
      } finally {
        x.shutdown();
        server.shutdown();
      }
    });

    it("should throw error for invalid server definition", () => {
      const createInvalidClient = () => {
        const client = new MemcacheClient({
          server: {} as any, // Invalid - neither SingleServerEntry nor MultipleServerEntry
          keyToServerHashFunction: simpleHashFunction,
        });
        return client;
      };
      expect(createInvalidClient).toThrow("Invalid server definition");
    });
  });

  describe("data isolation", () => {
    it("should not find key on wrong server", async () => {
      const servers = await Promise.all([
        memcached.startServer(serverOptions),
        memcached.startServer(serverOptions),
      ]);

      const ports = servers.map((s) => (s._server?.address() as AddressInfo).port);
      const serversUrls = ports.map((p) => ({ server: `localhost:${p}`, maxConnections: 3 }));

      // Create two clients with different hash functions
      const client1 = new MemcacheClient({
        server: { servers: serversUrls },
        keyToServerHashFunction: () => serversUrls[0].server, // Always route to server 0
      });

      const client2 = new MemcacheClient({
        server: { servers: serversUrls },
        keyToServerHashFunction: () => serversUrls[1].server, // Always route to server 1
      });

      try {
        // Set value using client1 (goes to server 0)
        await client1.set("isolated-key", "isolated-value");

        // Verify client1 can get it
        const result1 = await client1.get<string>("isolated-key");
        expect(result1.value).toEqual("isolated-value");

        // Client2 should not find it (looks on server 1)
        const result2 = await client2.get<string>("isolated-key");
        expect(result2).toBeUndefined();
      } finally {
        client1.shutdown();
        client2.shutdown();
        servers.forEach((s) => s.shutdown());
      }
    });
  });
});
