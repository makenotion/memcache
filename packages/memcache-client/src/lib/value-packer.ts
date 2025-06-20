/* eslint-disable no-bitwise,no-magic-numbers,max-params,no-unused-vars,max-statements,no-var */
/* eslint max-len:[2,120] */
import assert from "assert";
import { ValueFlags } from "./value-flags";
import { CompressorLibrary } from "../types";

type PackedData = { flag: number; data: string | Buffer };
type DecompressedData = string | number | Record<string, unknown> | Buffer;
export default class ValuePacker {
  compressor: CompressorLibrary;
  assumeBuffer: boolean;

  constructor(compressor: CompressorLibrary, assumeBuffer: boolean) {
    this.compressor = compressor;
    this.assumeBuffer = assumeBuffer;
  }

  pack(value: string | number | Record<string, unknown> | Buffer, compress: boolean): PackedData {
    const valueType = typeof value;
    const isBuffer = Buffer.isBuffer(value);

    var flag = 0;
    if (isBuffer) {
      flag = ValueFlags.TYPE_BINARY;
    } else if (valueType === "number") {
      flag = ValueFlags.TYPE_NUMERIC;
      value = JSON.stringify(value);
    } else if (valueType === "object") {
      flag = ValueFlags.TYPE_JSON;
      value = JSON.stringify(value);
    }

    if (compress && (value as string | Buffer).length >= 100) {
      assert(this.compressor !== undefined, "No compressor available to compress value");
      flag |= ValueFlags.COMPRESS;
      if (!isBuffer) {
        (value as unknown as Buffer) = Buffer.from(value as string);
      }
      value = this.compressor.compressSync({ input: value });
    }

    return { flag, data: value as string | Buffer };
  }

  unpack(packed: PackedData): DecompressedData {
    // retrieve data from cache and decode based on the type set via flags
    // if flags are not set, optionally assume binary type for migration from other libraries that don't use these flags
    const flag = packed.flag || (this.assumeBuffer ? ValueFlags.TYPE_BINARY : 0);
    const compress = (flag & ValueFlags.COMPRESS) === ValueFlags.COMPRESS;
    var data: string | number | Buffer = packed.data;

    if (compress) {
      assert(this.compressor !== undefined, "No compressor available to decompress data");
      data = this.compressor.decompressSync({ input: data });
    }

    const type = flag & ValueFlags.TYPE_ALL;

    if (type === ValueFlags.TYPE_NUMERIC) {
      data = +(data as string).toString();
    } else if (type === ValueFlags.TYPE_JSON) {
      data = JSON.parse(data as string);
    } else if (type !== ValueFlags.TYPE_BINARY) {
      data = (data as string).toString();
    }

    return data as DecompressedData;
  }
}
