/// <reference types="node" />
import { CompressorLibrary } from "../types";
declare type PackedData = {
    flag: number;
    data: string | Buffer;
};
declare type DecompressedData = string | number | Record<string, unknown> | Buffer;
export default class ValuePacker {
    compressor: CompressorLibrary;
    assumeBuffer: boolean;
    constructor(compressor: CompressorLibrary, assumeBuffer: boolean);
    pack(value: string | number | Record<string, unknown> | Buffer, compress: boolean): PackedData;
    unpack(packed: PackedData): DecompressedData;
}
export {};
