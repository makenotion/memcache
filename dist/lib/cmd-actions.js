"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionTypes = void 0;
exports.ActionTypes = ["OK", "ERROR", "RESULT", "SINGLE_RESULT", "SELF"];
const CmdActions = {
    OK: "OK",
    END: "SELF",
    DELETED: "OK",
    TOUCHED: "OK",
    STORED: "OK",
    //
    VALUE: "SELF",
    STAT: "RESULT",
    VERSION: "SINGLE_RESULT",
    //
    NOT_STORED: "ERROR",
    EXISTS: "ERROR",
    NOT_FOUND: "ERROR",
    //
    ERROR: "ERROR",
    CLIENT_ERROR: "ERROR",
    SERVER_ERROR: "ERROR",
    // Slabs Reassign error responses
    // - "BUSY [message]" to indicate a page is already being processed, try again
    //   later.
    // - "BUSY [message]" to indicate the crawler is already processing a request.
    BUSY: "ERROR",
    // - "BADCLASS [message]" a bad class id was specified
    BADCLASS: "ERROR",
    // - "NOSPARE [message]" source class has no spare pages
    NOSPARE: "ERROR",
    // - "NOTFULL [message]" dest class must be full to move new pages to it
    NOTFULL: "ERROR",
    // - "UNSAFE [message]" source class cannot move a page right now
    UNSAFE: "ERROR",
    // - "SAME [message]" must specify different source/dest ids.
    SAME: "ERROR",
    // Meta Protocol commands uses two letter codes
    HD: "OK",
    VA: "SELF",
    EN: "SELF",
    ME: "SELF",
    NS: "ERROR",
    EX: "ERROR",
    NF: "ERROR",
    MN: "SELF",
};
exports.default = CmdActions;
//# sourceMappingURL=cmd-actions.js.map