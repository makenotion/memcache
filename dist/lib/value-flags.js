"use strict";
/* eslint-disable no-bitwise,no-magic-numbers */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValueFlags = void 0;
const COMPRESS = 1;
const TYPE_JSON = 1 << 1;
const TYPE_NUMERIC = 1 << 2;
const TYPE_BINARY = 1 << 3;
const TYPE_ALL = TYPE_JSON | TYPE_NUMERIC | TYPE_BINARY;
exports.ValueFlags = {
    COMPRESS,
    TYPE_JSON,
    TYPE_NUMERIC,
    TYPE_BINARY,
    TYPE_ALL,
};
//# sourceMappingURL=value-flags.js.map