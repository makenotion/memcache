/// <reference types="node" />
import { ParserPendingData, DefaultLogger } from "../types";
export declare type PendingDataInternal = {
    data: Buffer;
    filled: number;
    cmd: string;
    cmdTokens: string[];
};
export declare class MemcacheParser {
    logger: DefaultLogger;
    _pending?: PendingDataInternal;
    _partialData?: Buffer;
    _cmdBrkLookupOffset?: number;
    constructor(logger?: DefaultLogger);
    onData(data: Buffer | undefined): void;
    processCmd(cmdTokens: string[] | number[]): number;
    receiveResult(result: ParserPendingData | string): void | ParserPendingData | string;
    initiatePending(cmdTokens: string[], length: number): void;
    malformDataStream(pending: Partial<PendingDataInternal>, data: Buffer | string, consumer?: string | number): void;
    malformCommand(cmdTokens?: string[]): void;
    unknownCmd(cmdTokens: string[]): void;
    _parseCmd(data: Buffer | undefined): Buffer | undefined;
    _copyPending(data: Buffer | undefined): Buffer | undefined;
    _checkPartialData(data: Buffer): Buffer | undefined;
    _processData(data: Buffer | undefined): Buffer | undefined;
}
