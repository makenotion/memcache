import { ErrorFirstCallback } from "../types";
export declare type CallbackablePromise<T extends any> = Promise<T> & {
    nodeify?: (callback: ErrorFirstCallback) => void;
};
export default function nodeify(promise: CallbackablePromise<unknown>, callback?: ErrorFirstCallback): Promise<unknown>;
