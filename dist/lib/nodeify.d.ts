import { ErrorFirstCallback } from "../types";
export type CallbackablePromise<T extends any> = Promise<T> & {
    nodeify?: (callback: ErrorFirstCallback) => void;
};
export default function nodeify<ValueType>(promise: CallbackablePromise<ValueType>, callback?: ErrorFirstCallback): Promise<ValueType>;
