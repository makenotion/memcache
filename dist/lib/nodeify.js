"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = nodeify;
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
//# sourceMappingURL=nodeify.js.map