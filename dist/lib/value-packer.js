"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/* eslint-disable no-bitwise,no-magic-numbers,max-params,no-unused-vars,max-statements,no-var */
/* eslint max-len:[2,120] */
const assert_1 = tslib_1.__importDefault(require("assert"));
const value_flags_1 = require("./value-flags");
class ValuePacker {
    constructor(compressor, assumeBuffer) {
        this.compressor = compressor;
        this.assumeBuffer = assumeBuffer;
    }
    pack(value, compress) {
        const valueType = typeof value;
        const isBuffer = Buffer.isBuffer(value);
        var flag = 0;
        if (isBuffer) {
            flag = value_flags_1.ValueFlags.TYPE_BINARY;
        }
        else if (valueType === "number") {
            flag = value_flags_1.ValueFlags.TYPE_NUMERIC;
            value = JSON.stringify(value);
        }
        else if (valueType === "object") {
            flag = value_flags_1.ValueFlags.TYPE_JSON;
            value = JSON.stringify(value);
        }
        if (compress && value.length >= 100) {
            (0, assert_1.default)(this.compressor !== undefined, "No compressor available to compress value");
            flag |= value_flags_1.ValueFlags.COMPRESS;
            if (!isBuffer) {
                value = Buffer.from(value);
            }
            value = this.compressor.compressSync({ input: value });
        }
        return { flag, data: value };
    }
    unpack(packed) {
        // retrieve data from cache and decode based on the type set via flags
        // if flags are not set, optionally assume binary type for migration from other libraries that don't use these flags
        const flag = packed.flag || (this.assumeBuffer ? value_flags_1.ValueFlags.TYPE_BINARY : 0);
        const compress = (flag & value_flags_1.ValueFlags.COMPRESS) === value_flags_1.ValueFlags.COMPRESS;
        var data = packed.data;
        if (compress) {
            (0, assert_1.default)(this.compressor !== undefined, "No compressor available to decompress data");
            data = this.compressor.decompressSync({ input: data });
        }
        const type = flag & value_flags_1.ValueFlags.TYPE_ALL;
        if (type === value_flags_1.ValueFlags.TYPE_NUMERIC) {
            data = +data.toString();
        }
        else if (type === value_flags_1.ValueFlags.TYPE_JSON) {
            data = JSON.parse(data);
        }
        else if (type !== value_flags_1.ValueFlags.TYPE_BINARY) {
            data = data.toString();
        }
        return data;
    }
}
exports.default = ValuePacker;
//# sourceMappingURL=value-packer.js.map