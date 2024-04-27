import { Shell } from "../utils/shell";
import { Newton } from "./newton";
import { MemCache } from "@/util/memcache";
import log from "../utils/log";
import { Token, whitespace } from "./model";
import { determineTokenType } from "./utils";

const parserCache = new MemCache<string, Newton>(1000 * 60 * 5);

const controlOperators = new Set(["||", "&&", ";;", "|&", "<(", ">>", ">&", "&", ";", "(", ")", "|", "<", ">"]);

/**
 * Starting from the end of the entry array, find the last sequence of strings, stopping when a non-string (i.e. an operand) is found.
 * @param entry The command line to search.
 * @returns The last sequence of strings, i.e. the last statement. If no strings are found, returns an empty array.
 */
function findLastStmt(entry: string, shell: Shell): Token[] {
    const entrySplit = entry.split(/\s+/g);
    log.debug(`Entry split: ${entrySplit}`);
    let entries: Token[] = [];
    for (let i = entrySplit.length - 1; i >= 0; i--) {
        let entryValue = entrySplit[i].valueOf();
        if (controlOperators.has(entryValue)) {
            break;
        } else if (entryValue) {
            entries.unshift({ value: entryValue, type: determineTokenType(entryValue, shell) });
        }
    }
    return entries;
}

export async function getSuggestions(curLine: string, cwd: string, shell: Shell): Promise<Fig.Suggestion[]> {
    if (!curLine) {
        return [];
    }
    const lastStmt = findLastStmt(curLine, shell);
    log.debug(`Last statement: ${lastStmt}`);
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
