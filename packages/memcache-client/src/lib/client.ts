import assert from "assert";
import { optionalRequire } from "optional-require";
import { Socket } from "net";

const Promise = optionalRequire("bluebird", {
  default: global.Promise,
});
const Zstd = optionalRequire("zstd.ts");

import nodeify from "./nodeify";
import ValuePacker from "./value-packer";
import nullLogger from "./null-logger";
import defaults from "./defaults";
import RedundantServers from "./redundant-servers";
import EventEmitter from "events";
import {
  MemcacheClientOptions,
  ResolveCallback,
  RejectCallback,
  ErrorFirstCallback,
  CommandContext,
  SingleServerEntry,
  PackedData,
  CompressorLibrary,
} from "../types";
import { MemcacheConnection } from "./connection";
import { DefaultLogger } from "memcache-parser";

type StoreParams = string | number | Buffer | Record<string, unknown>;

type CommonCommandOption = Readonly<{ noreply?: boolean; expectedResponses?: number }>;

type StoreCommandOptions = CommonCommandOption & { ignoreNotStored?: boolean } & Readonly<{
    lifetime?: number;
    compress?: boolean;
  }>;

type CasCommandOptions = CommonCommandOption &
  StoreCommandOptions &
  Readonly<{ casUniq: number | string }>;

type MetaGetOptions = StoreCommandOptions & {
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
export type MetaResult = {
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

type SocketCallback = (socket?: Socket) => void;

/* eslint-disable no-bitwise,no-magic-numbers,max-params,max-statements,no-var */
/* eslint max-len:[2,120] */
type OperationCallback<Error, Data> = (error?: Error | null, data?: Data) => void;
export type RetrievalCommandResponse<ValueType> = {
  tokens: string[];
  casUniq?: number | string;
  value: ValueType;
};

export type MetaRetrievalCommandResponse<ValueType> = MetaResult & {
  value: ValueType;
};

export type CasRetrievalCommandResponse<Type> = RetrievalCommandResponse<Type> & {
  casUniq: string | number;
};
export type StatsCommandResponse = Record<"STAT", Array<Array<string>>>;

export type MultiRetrievalResponse<ValueType = unknown> = Record<
  string,
  RetrievalCommandResponse<ValueType>
>;

export type MultiMetaRetrievalResponse<ValueType = unknown> = Record<
  string,
  MetaRetrievalCommandResponse<ValueType>
>;

export type MultiCasRetrievalResponse<ValueType = unknown> = Record<
  string,
  CasRetrievalCommandResponse<ValueType>
>;

type MultiCasRetrieval<ValueType> = ValueType extends MultiCasRetrievalResponse
  ? ValueType
  : CasRetrievalCommandResponse<ValueType>;

type MultiRetrieval<ValueType> = ValueType extends MultiRetrievalResponse
  ? ValueType
  : RetrievalCommandResponse<ValueType>;

type MultiMetaRetrieval<ValueType> = ValueType extends MultiMetaRetrievalResponse
  ? ValueType
  : MetaRetrievalCommandResponse<ValueType>;

export class MemcacheClient extends EventEmitter {
  options: MemcacheClientOptions;
  socketID: number;
  _logger: DefaultLogger;
  _servers: RedundantServers;
  private _packer: ValuePacker;
  private Promise: PromiseConstructor; // Promise definition seems complicated

  constructor(options: MemcacheClientOptions) {
    super();
    assert(options.server, "Must provide options.server");
    this.options = options;
    this.socketID = 1;
    this._packer = new ValuePacker(
      options.compressor || (Zstd as CompressorLibrary),
      options.assumeBuffer || false
    );
    this._logger = options.logger !== undefined ? options.logger : nullLogger;
    this.options.cmdTimeout = options.cmdTimeout || defaults.CMD_TIMEOUT_MS;
    this._servers = new RedundantServers(this, options.server as unknown as SingleServerEntry);
    this.Promise = options.Promise || Promise;
  }

  shutdown(): void {
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
  send<ValueType>(
    data: StoreParams | SocketCallback,
    options?: CommonCommandOption | ErrorFirstCallback,
    callback?: ErrorFirstCallback
  ): Promise<ValueType> {
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if (options === undefined) {
      options = {};
    }

    return this._callbackSend(data, options, callback) as unknown as Promise<ValueType>;
  }

  // the promise only version of send
  xsend(data: StoreParams | SocketCallback, options?: StoreCommandOptions): Promise<unknown> {
    return this._servers.doCmd((c: MemcacheConnection) =>
      this._send(c, data, options || {})
    ) as Promise<unknown>;
  }

  // a convenient method to send a single line as a command to the server
  // with \r\n appended for you automatically
  cmd<Response>(
    data: string,
    options?: CommonCommandOption,
    callback?: ErrorFirstCallback
  ): Promise<Response> {
    return this.send(
      (socket) => {
        let line = data;
        if (options?.noreply) {
          line += " noreply";
        }
        socket?.write(`${line}\r\n`);
      },
      options,
      callback
    ) as unknown as Promise<Response>;
  }

  // "set" means "store this data".
  set(
    key: string,
    value: StoreParams,
    options?: StoreCommandOptions | OperationCallback<Error, string[]>,
    callback?: OperationCallback<Error, string[]>
  ): Promise<string[]> {
    options = options || {};
    if ((options as StoreCommandOptions).ignoreNotStored === undefined) {
      (options as StoreCommandOptions).ignoreNotStored = this.options.ignoreNotStored;
    }
    // it's tricky to threat optional object as callback
    return this.store("set", key, value, options as StoreCommandOptions, callback);
  }

  // "add" means "store this data, but only if the server *doesn't* already
  // hold data for this key".
  add(
    key: string,
    value: StoreParams,
    options?: StoreCommandOptions | OperationCallback<Error, string[]>,
    callback?: OperationCallback<Error, string[]>
  ): Promise<string[]> {
    return this.store("add", key, value, options as StoreCommandOptions, callback);
  }

  // "replace" means "store this data, but only if the server *does*
  // already hold data for this key".
  replace(
    key: string,
    value: StoreParams,
    options?: StoreCommandOptions | OperationCallback<Error, string[]>,
    callback?: OperationCallback<Error, string[]>
  ): Promise<string[]> {
    return this.store("replace", key, value, options as StoreCommandOptions, callback);
  }

  // "append" means "add this data to an existing key after existing data".
  append(
    key: string,
    value: StoreParams,
    options?: StoreCommandOptions | OperationCallback<Error, string[]>,
    callback?: OperationCallback<Error, string[]>
  ): Promise<string[]> {
    return this.store("append", key, value, options as StoreCommandOptions, callback);
  }

  // "prepend" means "add this data to an existing key before existing data".
  prepend(
    key: string,
    value: StoreParams,
    options?: StoreCommandOptions | OperationCallback<Error, string[]>,
    callback?: OperationCallback<Error, string[]>
  ): Promise<string[]> {
    return this.store("prepend", key, value, options as StoreCommandOptions, callback);
  }

  // "cas" is a check and set operation which means "store this data but
  // only if no one else has updated since I last fetched it."
  //
  // cas unique must be passed in options.casUniq
  //
  cas(
    key: string,
    value: StoreParams,
    options: CasCommandOptions,
    callback?: OperationCallback<Error, string[]>
  ): Promise<string[]> {
    assert(options?.casUniq, "Must provide options.casUniq for cas store command");
    return this.store("cas", key, value, options, callback);
  }

  // delete key, fire & forget with options.noreply
  delete(
    key: string,
    options?: CommonCommandOption | OperationCallback<Error, string[]>,
    callback?: OperationCallback<Error, string[]>
  ): Promise<string[]> {
    return this.cmd(
      `delete ${key}`,
      options as CommonCommandOption,
      callback
    ) as unknown as Promise<string[]>;
  }

  // incr key by value, fire & forget with options.noreply
  incr(
    key: string,
    value: number,
    options?: StoreCommandOptions | OperationCallback<Error, string>,
    callback?: OperationCallback<Error, string>
  ): Promise<string> {
    return this.cmd(
      `incr ${key} ${value}`,
      options as StoreCommandOptions,
      callback
    ) as unknown as Promise<string>;
  }

  // decrease key by value, fire & forget with options.noreply
  decr(
    key: string,
    value: number,
    options?: StoreCommandOptions | OperationCallback<Error, string>,
    callback?: OperationCallback<Error, string>
  ): Promise<string> {
    return this.cmd(
      `decr ${key} ${value}`,
      options as StoreCommandOptions,
      callback
    ) as unknown as Promise<string>;
  }

  // touch key with exp time, fire & forget with options.noreply
  touch(
    key: string,
    exptime: string | number,
    options?: CommonCommandOption | OperationCallback<Error, string[]>,
    callback?: OperationCallback<Error, string[]>
  ): Promise<string[]> {
    return this.cmd(
      `touch ${key} ${exptime}`,
      options as CommonCommandOption,
      callback
    ) as unknown as Promise<string[]>;
  }

  // get version of server
  version(callback?: OperationCallback<Error, string[]>): Promise<string[]> {
    return this.cmd(`version`, {}, callback) as unknown as Promise<string[]>;
  }

  // a generic API for issuing one of the store commands
  store(
    cmd: string,
    key: string,
    value: StoreParams,
    options?: Partial<CasCommandOptions> | OperationCallback<Error, string[]>,
    callback?: OperationCallback<Error, string[]>
  ): Promise<string[]> {
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if (options === undefined) {
      options = {};
    }

    const lifetime =
      options.lifetime !== undefined ? options.lifetime : this.options.lifetime || 60;
    const casUniq = options.casUniq ? ` ${options.casUniq}` : "";
    const noreply = options.noreply ? ` noreply` : "";

    //
    // store commands
    // <command name> <key> <flags> <exptime> <bytes> [noreply]\r\n
    //
    const _data: SocketCallback = (socket?: Socket) => {
      const packed = this._packer.pack(
        value,
        (options as Partial<CasCommandOptions>)?.compress === true
      );
      const bytes = Buffer.byteLength(packed.data);
      socket?.write(
        Buffer.concat([
          Buffer.from(`${cmd} ${key} ${packed.flag} ${lifetime} ${bytes}${casUniq}${noreply}\r\n`),
          Buffer.isBuffer(packed.data) ? packed.data : Buffer.from(packed.data),
          Buffer.from("\r\n"),
        ])
      );
    };

    return this._callbackSend(_data, options, callback) as unknown as Promise<string[]>;
  }

  get<ValueType>(
    key: string | string[],
    options?: StoreCommandOptions | OperationCallback<Error, MultiRetrieval<ValueType>>,
    callback?: OperationCallback<Error, MultiRetrieval<ValueType>>
  ): Promise<MultiRetrieval<ValueType>> {
    return this.retrieve("get", key, options, callback);
  }

  mg<ValueType>(
    key: string | string[],
    options?: MetaGetOptions,
    callback?: OperationCallback<Error, MultiMetaRetrieval<ValueType>>
  ): Promise<MultiMetaRetrieval<ValueType>> {
    // always request value and flags
    // key is only requested when there is an array to identify the responses by key
    let metaFlags = Array.isArray(key) ? "v k f" : "v f";
    if (options?.keyAsBase64) {
      metaFlags += " b";
    }
    if (options?.includeCasToken) {
      metaFlags += " c";
    }
    if (options?.includeHasBeenHit) {
      metaFlags += " h";
    }
    if (options?.includeLastAccessed) {
      metaFlags += " l";
    }
    if (options?.includeRemainingTtl) {
      metaFlags += " t";
    }
    if (options?.dontBumpLru) {
      metaFlags += " n";
    }
    if (options?.vivifyOnMiss) {
      metaFlags += ` N${options.vivifyOnMiss}`;
    }
    if (options?.noreply) {
      metaFlags += " q";
    }
    return this.retrieve("mg", key, options, callback, metaFlags);
  }

  gets<ValueType>(
    key: string | string[],
    options?: StoreCommandOptions | OperationCallback<Error, MultiCasRetrieval<ValueType>>,
    callback?: OperationCallback<Error, MultiCasRetrieval<ValueType>>
  ): Promise<MultiCasRetrieval<ValueType>> {
    return this.retrieve("gets", key, options, callback);
  }

  // A generic API for issuing get or gets command
  retrieve<T>(
    cmd: string,
    key: string[] | string,
    options?: StoreCommandOptions | OperationCallback<Error, T>,
    callback?: ErrorFirstCallback,
    metaFlags?: string
  ): Promise<T> {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    return nodeify(this.xretrieve(cmd, key, options, metaFlags), callback) as unknown as Promise<T>;
  }

  // the promise only version of retrieve
  xretrieve(
    cmd: string,
    key: string | string[],
    options?: StoreCommandOptions,
    metaFlags?: string
  ): Promise<unknown> {
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
        ? this.xsend(key.map((k) => `${cmd} ${k} ${metaFlags}\r\n`).join(""), {
            ...options,
            expectedResponses: key.length,
          })
        : this.xsend(`${cmd} ${key} ${metaFlags}\r\n`, options).then((r: unknown) =>
            Object.values(r as Record<string, unknown>).shift()
          );
    }
    return Array.isArray(key)
      ? // NOTE: can't do this for meta commands, instead do "mg foo v\r\nmg bar v\r\nmg baz v\r\n"
        this.xsend(`${cmd} ${key.join(" ")}\r\n`, options)
      : this.xsend(`${cmd} ${key}\r\n`, options).then(
          (r: unknown) => (r as Record<string, unknown>)[key]
        );
  }

  //
  // Internal methods
  //
  _send(
    conn: MemcacheConnection,
    data: StoreParams | SocketCallback,
    options: Partial<CasCommandOptions>
  ): Promise<unknown> {
    try {
      // send data to connection
      if (typeof data === "function") {
        data(conn.socket);
      } else {
        conn.socket?.write(data as string);
      }

      // if no reply wanted then just return
      if (options.noreply) {
        return this.Promise.resolve();
      }

      // queue up context to listen for reply
      return new this.Promise((resolve: ResolveCallback, reject: RejectCallback) => {
        const context = {
          error: null,
          results: {},
          expectedResponses: options.expectedResponses || 1,
          callback: (err: Error, result: unknown) => {
            if (err) {
              if (options.ignoreNotStored === true && err.message === "NOT_STORED") {
                return resolve("ignore NOT_STORED");
              }
              return reject(err);
            }
            if (result) {
              return resolve(result);
            } else if (context.error) {
              return reject(context.error as unknown as Error);
            } else {
              return resolve(context.results);
            }
          },
        };

        conn.queueCommand(context as CommandContext);
      });
    } catch (err) {
      return this.Promise.reject(err);
    }
  }

  // internal send that expects all params passed (even if they are undefined)
  _callbackSend(
    data: StoreParams | SocketCallback,
    options?: Partial<CasCommandOptions>,
    callback?: ErrorFirstCallback
  ): Promise<unknown> {
    return nodeify(this.xsend(data, options), callback);
  }

  _unpackValue(result: PackedData): number | string | Record<string, unknown> | Buffer {
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
  _parseMeta(cmdTokens: string[]): MetaResult {
    // example input:
    // ["VA", "<flag><value>*", "<flag2><value2>*"]
    const metadata: MetaResult = {};
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
