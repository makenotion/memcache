/// <reference types="node" />
export declare type ParserPendingData = {
    key: string;
    data?: Buffer;
    flag?: number;
    bytes?: Buffer;
    casUniq?: number;
    cmdTokens: string[];
};
export declare type DefaultLogger = Record<"error" | "debug" | "info" | "warn", (msg: string) => void>;
