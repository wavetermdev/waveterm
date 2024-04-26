import * as shellQuote from "shell-quote";
import { Shell } from "../utils/shell";
import { Newton } from "./newton";
import { MemCache } from "@/util/memcache";
import log from "../utils/log";
import { Token, whitespace } from "./model";
import { determineTokenType } from "./utils";

const parserCache = new MemCache<string, Newton>(1000 * 60 * 5);

/**
 * Starting from the end of the entry array, find the last sequence of strings, stopping when a non-string (i.e. an operand) is found.
 * @param entry The entry array to search.
 * @returns The last sequence of strings, i.e. the last statement. If no strings are found, returns an empty array.
 */
function findLastStmt(entry: shellQuote.ParseEntry[], shell: Shell): Token[] {
    let entries: Token[] = [];
    for (let i = entry.length - 1; i >= 0; i--) {
        let entryValue = entry[i].valueOf();
        if (typeof entryValue == "string") {
            entries.unshift({ value: entryValue, type: determineTokenType(entryValue, shell) });
        } else {
            break;
        }
    }
    return entries;
}

export async function getSuggestions(curLine: string, cwd: string, shell: Shell): Promise<Fig.Suggestion[]> {
    log.debug("getSuggestions", curLine, cwd, shell);
    const entry = shellQuote.parse(curLine);
    const lastStmt = findLastStmt(entry, shell);
    if (curLine.endsWith(" ")) {
        // shell-quote doesn't include trailing space in parse. We need to know this to determine if we should suggest subcommands
        lastStmt.push(whitespace);
    }
    const lastStmtStr = lastStmt.slice(0, lastStmt.length - 2).join(" ");
    // let parser: Newton = parserCache.get(lastStmtStr);
    // if (parser) {
    //     console.log("Using cached parser");
    //     parser.cwd = cwd;
    //     parser.shell = shell;
    //     parser.entries = lastStmt;
    //     parser.entryIndex = parser.entryIndex - 1;
    // } else {
    //     console.log("Creating new parser");
    //     parser = new Newton(undefined, lastStmt, cwd, shell);
    // }
    const parser: Newton = new Newton(undefined, lastStmt, cwd, shell);
    const retVal = await parser.generateSuggestions();
    parserCache.put(lastStmtStr, parser);
    return retVal;
}
