"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function nodeify(promise, callback) {
    if (callback) {
        if (promise.nodeify !== undefined) {
            promise.nodeify(callback);
        }
        else {
            promise.then((v) => callback(null, v), (err) => callback(err));
        }
    }
    return promise;
}
exports.default = nodeify;
//# sourceMappingURL=nodeify.js.map