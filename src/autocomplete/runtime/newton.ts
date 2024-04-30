// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Some code in this file has been modified from various files in https://github.com/microsoft/inshellisense
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import log from "../utils/log";
import { Shell } from "../utils/shell";
import { runGenerator } from "./generator";
import { FilterStrategy, getIcon } from "./suggestion";
import { runTemplates } from "./template";
import {
    buildExecuteShellCommand,
    equalsAny,
    getAll,
    getFirst,
    getPathSep,
    isFlag,
    isOption,
    matchAny,
    modifyPosixFlags,
    resolveCwdToken,
    sortSuggestions,
    startsWithAny,
} from "./utils";
import { getSubcommand, lazyLoadSpecLocation, loadSpec } from "./loadspec";
import { PathToken, Token, TokenType, whitespace } from "./model";

/**
 * The parser state. This is used to determine what the parser is currently matching.
 */
enum ParserState {
    /**
     * The parser is currently matching subcommands.
     */
    Subcommand,

    /**
     * The parser is currently matching options or non-POSIX flags.
     */
    Option,

    /**
     * The parser is currently matching POSIX flags.
     */
    PosixFlag,

    /**
     * The parser is currently matching arguments for an option or flag.
     */
    OptionArgument,

    /**
     * The parser is currently matching subcommand arguments.
     */
    SubcommandArgument,
}

/**
 * A parser for a Fig.Subcommand spec. This class is used to traverse a spec and return suggestions for a given set of args.
 */
export class Newton {
    /**
     * The error message, if any.
     */
    private error: string | undefined;

    /**
     * The split segments of the current command.
     */
    public entries: Token[];

    /**
     * The current index within `this.entries` that the parser is processing.
     */
    public entryIndex: number;

    /**
     * The options for the current command, as defined in the spec. A shorthand for `this.spec.options`.
     */
    private options: Fig.Option[];

    /**
     * The subcommands for the current command, as defined in the spec. A shorthand for `this.spec.subcommands`.
     */
    private subcommands: Fig.Subcommand[];

    /**
     * The most-recently-matched option. This is used to determine the final set of suggestions.
     */
    private currentOption: Fig.Option | undefined;

    /**
     * The most-recently-matched argument. This is used to determine the final set of suggestions.
     */
    private args: Fig.Arg[] | undefined;

    /**
     * The current argument index when parsing subcommand arguments. This is used to determine which argument the parser is currently matching.
     */
    private subcommandArgIndex: number = 0;

    /**
     * The current argument index when parsing option arguments. This is used to determine which argument the parser is currently matching.
     */
    private optionArgIndex: number = 0;

    /**
     * The available options for the current command. This is a map of option names to options. This is used to keep track of which options have already been used.
     */
    private availableOptions: Record<string, Fig.Option> = {};

    /**
     * A map of option names to their dependent options. This is defined in the spec as `dependsOn`. Any options present in this map will be suggested with the highest priority.
     */
    private dependentOptions: Record<string, Fig.Option[]> = {};

    /**
     * A map of option names to their mutually exclusive options. This is defined in the spec as `exclusiveOn`. Any options present in this map will be removed from the available options set and flagged as invalid.
     */
    private mutuallyExclusiveOptions: Record<string, Fig.Option[]> = {};

    /**
     * Determines whether the parser should treat flags as POSIX-compliant. This is defined in the spec as `parserDirectives.flagsArePosixNoncompliant`.
     */
    private flagsArePosixNoncompliant: boolean;

    /**
     * Determines whether options or flags can precede arguments. This is defined in the spec as `parserDirectives.optionsMustPrecedeArguments`.
     */
    private optionsMustPrecedeArguments: boolean;

    /**
     * The option argument separators to use for the current command. This is defined in the spec as `parserDirectives.optionArgSeparators`.
     * Remark: This does not appear to be widely used and most specs define argument separators in the options themselves. As this is mostly redundant, we may remove this in the future.
     */
    private optionArgSeparators: string[];

    /**
     * Determines whether the parser should stop interpreting options. This is used when the user enters a double dash `--` to disable options and flags.
     */
    private stopInterpretingOptions: boolean = false;

    /**
     * The spec for the current command.
     */
    private _spec: Fig.Subcommand | undefined;

    /**
     * The number of iterations the parser has run. This is used to prevent infinite loops.
     */
    private _numIters: number = 0;

    /**
     * The current state of the parser.
     */
    private curState: ParserState = ParserState.Subcommand;

    /**
     * The previous state of the parser.
     */
    private prevState: ParserState | undefined;

    /**
     * The suggestions that will be returned to the user.
     */
    private suggestions: Map<string, Fig.Suggestion> = new Map();

    /**
     * The current working directory for the parser.
     */
    private cwd: string;

    /**
     * The environment variables for the current command.
     */
    private envVars: Record<string, string>;

    /**
     * The user's shell type.
     */
    public shell: Shell;

    constructor(
        spec: Fig.Subcommand | undefined,
        entries: Token[],
        cwd: string,
        shell: Shell,
        envVars?: Record<string, string>,
        entryIndex: number = 0,
        flagsArePosixNoncompliant: boolean = spec?.parserDirectives?.flagsArePosixNoncompliant ?? false,
        optionsMustPrecedeArguments: boolean = spec?.parserDirectives?.optionsMustPrecedeArguments ?? false,
        optionArgSeparators: string[] = spec?.parserDirectives?.optionArgSeparators
            ? getAll(spec.parserDirectives?.optionArgSeparators)
            : ["="],
        options: Fig.Option[] = spec?.options ?? [],
        subcommands: Fig.Subcommand[] = spec?.subcommands ?? []
    ) {
        this.spec = spec;
        this.entries = entries;

        // Clean the CWD to ensure it ends with a path separator
        const sep = getPathSep(shell);
        this.cwd = cwd.endsWith(sep) ? cwd : cwd + sep;
        this.envVars = envVars;

        this.shell = shell;
        this.entryIndex = entryIndex;
        this.flagsArePosixNoncompliant = flagsArePosixNoncompliant;
        this.optionsMustPrecedeArguments = optionsMustPrecedeArguments;
        this.optionArgSeparators = optionArgSeparators;
        this.options = options;
        this.subcommands = subcommands;
    }

    /**
     * Get the spec for the current command.
     */
    private get spec(): Fig.Subcommand | undefined {
        return this._spec;
    }

    /**
     * Set the spec for the current command. This also sets the available options set and other parser directives, as defined in the spec.
     */
    private set spec(spec: Fig.Subcommand | undefined) {
        this._spec = spec;
        this.options = spec?.options ?? [];
        this.currentOption = undefined;
        this.args = getAll(spec?.args);
        this.subcommandArgIndex = 0;
        this.availableOptions = {};
        this.dependentOptions = {};
        this.suggestions = new Map();
        this.subcommands = spec?.subcommands ?? [];
        this.mutuallyExclusiveOptions = {};
        this.optionsMustPrecedeArguments =
            spec?.parserDirectives?.optionsMustPrecedeArguments ?? this.optionsMustPrecedeArguments;
        this.flagsArePosixNoncompliant =
            spec?.parserDirectives?.flagsArePosixNoncompliant ?? this.flagsArePosixNoncompliant;
        this.optionArgSeparators = spec?.parserDirectives?.optionArgSeparators
            ? getAll(spec.parserDirectives?.optionArgSeparators)
            : ["="];
        this.stopInterpretingOptions = false;
        for (const option of this.options) {
            for (const name of getAll(option.name)) {
                this.availableOptions[name] = option;
            }
        }
    }

    /**
     * Gets the current entry in the list of entries.
     * @see entries
     * @see entryIndex
     */
    private get currentEntry(): Token | undefined {
        log.debug("currentEntry", this.entryIndex, this.entries);
        return this.entries.at(this.entryIndex);
    }

    /**
     * Gets the last entry in the list of entries.
     * @see entries
     */
    private get lastEntry(): Token {
        return this.entries.at(-1);
    }

    /**
     * Sets the last entry in the list of entries.
     * @param value The value to set the last entry to.
     */
    private set lastEntry(value: Token) {
        this.entries[this.entries.length - 1] = value;
    }

    /**
     * Checks if the parser is at the end of the entry array.
     * @returns True if the parser is at the end of the entry array.
     * @see entries
     * @see entryIndex
     */
    private get atEndOfEntries(): boolean {
        return this.entryIndex >= this.entries.length || this.currentEntry.type == TokenType.WHITESPACE;
    }

    /**
     * Checks if the parser is at the last entry of the entry array.
     * @returns True if the parser is at the last entry of the entry array.
     * @see entries
     * @see entryIndex
     */
    private get atLastEntry(): boolean {
        return this.entryIndex == this.entries.length - 1;
    }

    /**
     * Gets all options that are POSIX-compliant flags.
     * @returns All options that are POSIX-compliant flags, empty array if parser directives specify that flags are POSIX-noncompliant
     * @see flagsArePosixNoncompliant
     * @see availableOptions
     */
    private get availablePosixFlags(): Fig.Option[] {
        log.debug("availablePosixFlags", this.flagsArePosixNoncompliant, this.availableOptions);
        return this.flagsArePosixNoncompliant
            ? []
            : Object.values(this.availableOptions).filter((value) => matchAny(value.name, isFlag));
    }

    /**
     * Filters out flags from the available options if the flags are POSIX-compliant.
     * @returns All options that are not POSIX-compliant flags
     * @see flagsArePosixNoncompliant
     * @see availableOptions
     */
    private get availableNonPosixFlags(): Fig.Option[] {
        log.debug("availableNonPosixFlags", this.flagsArePosixNoncompliant, this.availableOptions);
        const retVal = this.flagsArePosixNoncompliant
            ? Object.values(this.availableOptions)
            : Object.values(this.availableOptions).filter((value) => matchAny(value.name, isOption));
        return retVal;
    }

    /**
     * Get an option by name from the available options set.
     * @param name The name of the option to get.
     * @returns The option, or undefined if the option is not available.
     * @see availableOptions
     */
    private getAvailableOption(name: Token | string): Fig.Option | undefined {
        return this.availableOptions[typeof name == "string" ? name : name.value];
    }

    /**
     * Record an option as having been used, removing it from the available options set. This should remove both the flag and the option version.
     * @param option The option to record.
     * @see availableOptions
     */
    private recordOption(option: Fig.Option) {
        for (const name of getAll(option.name)) {
            delete this.availableOptions[name];
        }
    }

    /**
     * Identify dependent and mutually exclusive options and modify the available options set accordingly. Dependent options are given the highest priority, while exclusive options are removed from the available options set.
     * @param option The option to check.
     * @see getAvailableOption
     * @see dependentOptions
     * @see mutuallyExclusiveOptions
     */
    private findDependentAndExclusiveOptions(option: Fig.Option) {
        if (option.dependsOn) {
            const dependentOptions: Fig.Option[] = [];

            for (const name of option.dependsOn) {
                const dependentOption = this.getAvailableOption(name);
                if (dependentOption) {
                    // Dependent options are given the highest priority
                    dependentOptions.push(dependentOption);
                    const modifiedPriority = { ...dependentOption };
                    modifiedPriority.priority = 1000;
                    this.availableOptions[name] = modifiedPriority;
                }
            }
            for (const name of getAll(option.name)) {
                this.dependentOptions[name] = dependentOptions;
            }
        }
        if (option.exclusiveOn) {
            const mutuallyExclusiveOptions: Fig.Option[] = [];
            for (const name of option.exclusiveOn) {
                const exclusiveOption = this.getAvailableOption(name);
                if (exclusiveOption) {
                    // If the exclusive option is available, remove it so it won't be suggested.
                    delete this.availableOptions[name];
                    mutuallyExclusiveOptions.push(exclusiveOption);
                }
            }
            for (const name of getAll(option.name)) {
                this.mutuallyExclusiveOptions[name] = mutuallyExclusiveOptions;
            }
        }
    }

    /**
     * Check if the option has an argument separator. If so, break it up and add the arguments as separate entries.
     */
    private breakOutOptionArgs() {
        const entry = this.currentEntry;
        if (this.optionArgSeparators.length > 0) {
            log.debug("optionArgSeparators", this.optionArgSeparators);
            for (const sep of this.optionArgSeparators) {
                log.debug("optionArgSeparators", sep);
                if (entry.value.includes(sep)) {
                    log.debug("optionArgSeparators", sep, entry);
                    const optionStr = entry.value.substring(0, entry.value.indexOf(sep));
                    log.debug("optionStr", optionStr);
                    const option = this.getAvailableOption(optionStr);
                    log.debug("option", option);
                    if (
                        option &&
                        (option.requiresSeparator === sep ||
                            (option.requiresSeparator === true && this.optionArgSeparators.length == 1))
                    ) {
                        this.entries[this.entryIndex].value = optionStr;
                        const argToken = {
                            type: TokenType.ARGUMENT,
                            value: entry.value.substring(entry.value.indexOf(sep) + 1, entry.value.length),
                        };
                        log.debug("argStr", argToken);
                        if (argToken.value.length > 0) {
                            this.entries.splice(this.entryIndex + 1, 0, argToken);
                        } else if (this.atLastEntry) {
                            this.entries.push(whitespace);
                        } else {
                            this.error = `The option ${optionStr} requires an argument with a separator "${sep}".`;
                        }
                        return;
                    }
                } else if (!this.atLastEntry && this.getAvailableOption(entry.value)?.requiresSeparator) {
                    this.error = `The option ${entry} requires an argument with a separator.`;
                    return;
                }
            }
        }
    }

    /**
     * Parses the flag in the current entry and modifies the available options set accordingly.
     */
    private parseFlag(): ParserState {
        this.breakOutOptionArgs();
        const entry = this.currentEntry;
        if (!entry) {
            return;
        }

        log.debug("parseFlag", entry);
        const existingFlags = entry?.value.slice(1);
        const flagsArr = existingFlags?.split("") ?? [];
        if (flagsArr.length == 0) {
            return ParserState.Option;
        }
        for (const index of flagsArr.keys()) {
            const flag = flagsArr[index];
            const option = this.getAvailableOption(`-${flag}`);
            if (option) {
                // If the option is available, record it and move on to the next flag
                if (option.args) {
                    if (index < flagsArr.length - 1) {
                        const hasRequiredArgs = getAll(option.args).find((arg) => !arg.isOptional) != null;
                        if (hasRequiredArgs) {
                            // If the option has required args and is not the last flag, it is invalid
                            this.error = `The option ${option.name} is invalid as it has required arguments and is not the last flag.`;
                            break;
                        }
                    }
                }
                // Identify dependent and mutually exclusive options
                this.findDependentAndExclusiveOptions(option);
                this.recordOption(option);
                this.currentOption = option;
            } else {
                // If the option is not available, it has already been used or is not a valid option
                this.error = `The option ${entry} is not valid.`;
                return ParserState.Subcommand;
            }
        }
        if (!this.currentOption) {
            log.debug("no current option");
            return ParserState.Option;
        } else if (this.currentOption.args !== undefined) {
            log.debug("current option has args");
            return ParserState.OptionArgument;
        } else if (!this.atLastEntry) {
            // We are not done parsing the user entries so we should return to the subcommand state and then decide the next state.
            log.debug("current option does not have args, return to subcommand");
            return ParserState.Subcommand;
        } else {
            // We are at the last entry so we can assume the user is not done writing the flag
            return ParserState.PosixFlag;
        }
    }

    /**
     * Parses the option in the current entry and modifies the available options set accordingly.
     */
    private parseOption(): ParserState {
        // This means we cannot use POSIX-style flags, so we have to check each option individually
        log.debug("parseOption");
        this.breakOutOptionArgs();
        const entry = this.currentEntry;
        if (!entry) {
            log.debug("no entry, returning and setting state to subcommand");
            return ParserState.Subcommand;
        }

        // We need to handle cases where a double dash is used to disable options and flags, such as in git commands.
        if (entry.value === "--") {
            if (this.atLastEntry) {
                log.debug(
                    "double dash at last entry, returning and setting state to option to process all available options"
                );
                this.currentOption = undefined;
                return ParserState.Option;
            } else {
                log.debug("double dash not at last entry, disabling options and flags for all subsequent entries");
                this.stopInterpretingOptions = true;
                return ParserState.Subcommand;
            }
        }

        if (!this.atLastEntry) {
            // If the arg is not the last entry, we can check if it is a valid option
            const option = this.getAvailableOption(entry);
            if (option) {
                // If the option is available, record it and move on to the next arg
                this.recordOption(option);

                // Identify dependent and mutually exclusive options, verify that they are valid.
                this.findDependentAndExclusiveOptions(option);

                this.currentOption = option;
                if (option.args !== undefined) {
                    log.debug("option has args", option.args);
                    return ParserState.OptionArgument;
                } else {
                    return ParserState.Subcommand;
                }
            } else {
                // If the option is not available, it has already been used or is not a valid option
                this.error = `The option ${entry} is not valid.`;
            }
        } else {
            // The entry is incomplete, but it's the last one so we can just suggest all that start with the entry.
            this.currentOption = undefined;
        }
        return ParserState.Option;
    }

    /**
     * Parses the the current entry as an argument for either a subcommand or an option. This will determine the next state of the parser.
     */
    private async parseArgument(): Promise<ParserState> {
        const entry = this.currentEntry;
        let args = this.args;
        let argIndex = this.subcommandArgIndex;
        if (this.curState == ParserState.OptionArgument) {
            if (this.prevState == ParserState.Option) {
                // This is a new set of option arguments, so we need to reset the argIndex
                this.optionArgIndex = 0;
            }
            argIndex = this.optionArgIndex;
            args = getAll(this.currentOption.args);
        }

        const incrementArgIndex = () => {
            argIndex++;
            if (this.curState == ParserState.OptionArgument) {
                this.optionArgIndex++;
            } else {
                this.subcommandArgIndex++;
            }
        };

        if (!entry || args.length == 0) {
            log.debug("returning early from parseArgument", this.prevState);
            return this.prevState;
        }

        const currentArg = args[argIndex];

        if (currentArg) {
            const curEntryType = entry.type;
            if (currentArg.isCommand) {
                // The next entry is a command, so we need to load the spec for that command and start from scratch
                this.spec = undefined;
                return ParserState.Subcommand;
            } else if (curEntryType == TokenType.OPTION || curEntryType == TokenType.FLAG) {
                // We found an option or a flag, we will need to determine if this is allowed before continuing
                if (!currentArg.isOptional || !currentArg.isVariadic) {
                    this.error = `The argument ${currentArg.name} is required and cannot be a flag or option.`;
                } else if (currentArg.isVariadic && currentArg.optionsCanBreakVariadicArg && !this.atLastEntry) {
                    // If options can break the variadic argument, we should try parsing the option and then return to parsing the arguments.
                    this.entryIndex++;
                    this.parseOption();
                    this.currentOption = undefined;
                    return ParserState.SubcommandArgument;
                }
                return ParserState.Option;
            } else if (currentArg.isOptional) {
                // The argument is optional, we want to see if we have any matches before determining if we should move on.
                const numAdded = await this.addSuggestionsForArg(currentArg, true);
                if (!this.atLastEntry && numAdded > 0) {
                    // We found a match and we are not at the end of the entry list, so let's keep matching arguments for the next entry
                    log.debug("has suggestion match for optional arg");
                    incrementArgIndex();
                    return ParserState.SubcommandArgument;
                } else {
                    // We did not find a match, we should return to the previous state.
                    log.debug("no suggestion found for optional arg");
                    return this.prevState;
                }
            } else if (currentArg.isVariadic) {
                // Assume that the next entry is going to be another argument of the same type
                return this.curState;
            } else {
                // Will try to match the next entry to the next argument in the list.
                incrementArgIndex();
                return this.curState;
            }
        } else {
            // We did not identify an argument to parse, return to the previous state
            return this.prevState;
        }
    }

    /**
     * After a set of suggestions has been generated, this function will clean up the suggestions and remove unnecessary fields.
     * @param suggestion The suggestion to clean up.
     * @param defaultType The default type to use if the suggestion does not have a type.
     * @param prefixStr The prefix to add to the suggestion name, if any.
     * @returns The cleaned up suggestion.
     */
    private prepareSuggestion(
        suggestion: Fig.Suggestion,
        defaultType: Fig.SuggestionType,
        prefixStr?: string
    ): Fig.Suggestion {
        if (suggestion == undefined) {
            return undefined;
        }
        let partialCmd = this.lastEntry;
        const entryPathPrefix = (partialCmd as PathToken)?.prefix ?? "";
        const suggestionMin: Fig.Suggestion = {
            name: suggestion.name,
            displayName: suggestion.displayName,
            description: suggestion.description,
            icon: suggestion.icon,
            type: suggestion.type,
            insertValue: suggestion.insertValue,
            priority: suggestion.priority,
        };
        log.debug(
            "prepareSuggestion",
            "suggestion",
            suggestion,
            "suggestionMin",
            suggestionMin,
            "partialCmd",
            partialCmd
        );

        if (suggestionMin.name && prefixStr) {
            suggestionMin.name = getAll(suggestionMin.name).map((name) => prefixStr + name);
        }

        if (!suggestionMin.type) {
            suggestionMin.type = defaultType;
        }
        if (!suggestionMin.icon) {
            suggestionMin.icon = getIcon(suggestionMin.icon, suggestionMin.type);
        } else if (suggestionMin.icon.startsWith("fig://")) {
            suggestionMin.icon = getIcon(suggestionMin.icon, "special");
        }
        if (!suggestionMin.insertValue) {
            log.debug("prepareSuggestion no insertValue", suggestionMin.name, partialCmd);
            if (!partialCmd?.value) {
                log.debug("prepareSuggestion no insertValue, no partialCmd", getFirst(suggestionMin.name));
                suggestionMin.insertValue = getFirst(suggestionMin.name);
            } else {
                for (const name of getAll(suggestionMin.name)) {
                    if (name.startsWith(partialCmd.value) && name.length > (suggestionMin.insertValue?.length ?? 0)) {
                        log.debug("prepareSuggestion insertValue found", name, partialCmd);
                        suggestionMin.insertValue = name;
                    }
                }

                log.debug(
                    "prepareSuggestion substring length",
                    suggestionMin.insertValue?.length,
                    partialCmd.value?.length
                );
                // suggestionMin.insertValue = suggestionMin.insertValue?.slice(partialCmd.length);
            }
            log.debug("prepareSuggestion insertValue final", suggestionMin.insertValue);
        } else {
            log.debug("prepareSuggestion insertValue exists", suggestionMin.insertValue, partialCmd);
            // Handle situations where the maintainer of the spec includes the command in the insertValue, failing to account for the fact that the user may have already typed the command.
            const startsWithPartialCmd = suggestionMin.insertValue.startsWith(partialCmd.value);
            for (const name in getAll(suggestionMin.name)) {
                if (suggestionMin.insertValue.startsWith(name) && !startsWithPartialCmd) {
                    suggestionMin.insertValue = suggestionMin.insertValue.slice(name.length);
                    break;
                }
            }
            log.debug("prepareSuggestion insertValue final", suggestionMin.insertValue);
        }

        if ((suggestionMin.insertValue && suggestionMin.type == "file") || suggestionMin.type == "folder") {
            log.debug(
                `prepareSuggestion add entryPathPrefix "${entryPathPrefix}" to insert value "${suggestionMin.insertValue}"`
            );
            suggestionMin.insertValue = entryPathPrefix + suggestionMin.insertValue;
        }
        if (!suggestionMin.priority) {
            switch (suggestionMin.type) {
                case "option":
                    suggestionMin.priority = 50;
                    break;
                case "subcommand":
                    suggestionMin.priority = 51;
                    break;
                case "arg":
                    suggestionMin.priority = 52;
                    break;
                case "file":
                    suggestionMin.priority = 49;
                    break;
                default:
                    suggestionMin.priority = 50;
            }
        }
        return suggestionMin;
    }

    /**
     * Filter the suggestions using the specified filtering strategy.
     * @param suggestions The suggestions to filter
     * @param filterStrategy The filtering strategy to use. Will default to "prefix".
     * @param partialCmd The current entry to use when filtering out the suggestions.
     * @param suggestionType The type of suggestion object to interpret (currently not used by Newton).
     * @returns The filtered suggestions.
     */
    private filterSuggestionsAndAddToMap(
        suggestions: (Fig.Suggestion | string)[],
        filterStrategy: FilterStrategy,
        partialCmd: Token,
        suggestionType: Fig.SuggestionType,
        prefixStr?: string
    ) {
        log.debug(
            "filter",
            "suggestions",
            suggestions,
            "filterStrategy",
            filterStrategy,
            "partialCmd",
            `"${partialCmd}"`,
            "suggestionType",
            suggestionType
        );
        const suggestionsArr = suggestions.map((s) => (typeof s === "string" ? { name: s } : s));
        if (!partialCmd || partialCmd.type == TokenType.WHITESPACE) {
            this.addSuggestionsToMap(suggestionsArr, suggestionType, prefixStr);
            return;
        }

        if (filterStrategy === "fuzzy") {
            log.debug("fuzzy");
            suggestionsArr.forEach((s) => {
                if (s.name == null) return;
                if (s.name instanceof Array) {
                    const matchedName = s.name.find((n) => n.toLowerCase().includes(partialCmd.value.toLowerCase()));
                    if (matchedName) {
                        this.addSuggestionsToMap([{ name: matchedName }], suggestionType, prefixStr);
                    }
                } else if (s.name.toLowerCase().includes(partialCmd.value.toLowerCase())) {
                    this.addSuggestionsToMap([s], suggestionType, prefixStr);
                }
            });
        } else {
            log.debug("prefix");
            suggestionsArr.forEach((s) => {
                log.debug("prefix", s.name, partialCmd);
                if (s.name == null) return;
                if (s.name instanceof Array) {
                    const matchedName = s.name.find((n) => n.toLowerCase().startsWith(partialCmd.value.toLowerCase()));
                    if (matchedName) {
                        this.addSuggestionsToMap([{ name: matchedName }], suggestionType, prefixStr);
                    }
                } else if (s.name.toLowerCase().startsWith(partialCmd.value.toLowerCase())) {
                    this.addSuggestionsToMap([s], suggestionType, prefixStr);
                }
            });
        }
    }

    /**
     * Add suggestions to the suggestions map.
     * @param suggestions The suggestions to add.
     * @param suggestionType The default suggestion type to use if the suggestion does not have a type.
     * @param prefixStr The prefix string to add to the suggestions, if any.
     */
    private addSuggestionsToMap(suggestions: Fig.Suggestion[], suggestionType: Fig.SuggestionType, prefixStr?: string) {
        suggestions?.forEach((suggestion) => {
            this.suggestions.set(
                getFirst(suggestion.name),
                this.prepareSuggestion(suggestion, suggestionType, prefixStr)
            );
        });
    }

    /**
     * Add suggestions for the current argument.
     * @param arg The argument to add suggestions for.
     * @param dryRun Whether to actually add the suggestions or just count them.
     * @param prefixStr The prefix string to add to the suggestions, if any.
     * @returns The number of suggestions added.
     */
    private async addSuggestionsForArg(arg: Fig.Arg, dryRun: boolean, prefixStr?: string): Promise<number> {
        let entry = this.lastEntry;
        const suggestions: Fig.Suggestion[] = [];

        if (arg?.generators) {
            const generators = getAll(arg.generators);
            log.debug("arg generators", generators);
            suggestions.push(
                ...(
                    await Promise.all(
                        generators.map((gen) =>
                            runGenerator(
                                gen,
                                this.entries.map((e) => e.value),
                                this.cwd,
                                this.envVars
                            )
                        )
                    )
                ).flat()
            );
        }

        if (arg?.suggestions) {
            log.debug("arg suggestions", arg.suggestions);
            suggestions.push(...(arg.suggestions.map((s) => (typeof s === "string" ? { name: s } : s)) ?? []));
        }

        if (arg?.template) {
            log.debug("arg template", arg.template, this.cwd);
            suggestions.push(...(await runTemplates(arg.template ?? [], this.cwd)));
        }

        if (!dryRun) {
            this.filterSuggestionsAndAddToMap(
                suggestions,
                arg.filterStrategy ?? this.spec.filterStrategy,
                entry,
                "arg",
                prefixStr
            );
        }
        return suggestions.length;
    }

    /**
     * Add the subcommands for the current spec as suggestions.
     */
    private addSuggestionsForSubcommands() {
        this.filterSuggestionsAndAddToMap(this.subcommands, this.spec?.filterStrategy, this.lastEntry, "subcommand");
    }

    /**
     * Add all available options and flags as suggestions.
     */
    private addSuggestionsForOptionsAndFlags() {
        if (this.stopInterpretingOptions) {
            log.debug("cannot add suggestions for options after --");
            return;
        }
        const entry = this.lastEntry;
        const precedingFlagsMaybe = entry?.value?.slice(1) ?? "";
        const availableOptions = [
            ...this.availablePosixFlags.map((option) => modifyPosixFlags(option, precedingFlagsMaybe)),
            ...this.availableNonPosixFlags,
        ];
        log.debug("availableOptions:", availableOptions);
        this.filterSuggestionsAndAddToMap(availableOptions, this.spec?.filterStrategy, entry, "option");
    }

    /**
     * Runs the history template and adds the suggestions to the suggestions map. This skips the filtering as the history template already does this.
     */
    private async addSuggestionsForHistory(cwd: string = this.cwd): Promise<void> {
        this.addSuggestionsToMap(await runTemplates("history", cwd), "special");
    }

    /**
     * Runs the filepaths template and adds the suggestions to the suggestions map.
     */
    private async addSuggestionsForFilepaths(cwd: string = this.cwd): Promise<void> {
        log.debug("addSuggestionsForFilepaths", cwd, this.lastEntry, this.spec?.filterStrategy);
        this.filterSuggestionsAndAddToMap(
            await runTemplates("filepaths", cwd),
            this.spec?.filterStrategy,
            this.lastEntry,
            "file"
        );
    }

    /**
     * Loads the spec for the current command. If the command defines a `loadSpec` function, that function is run and the result is set as the new spec. Otherwise, the spec is set to the command itself.
     * @returns The spec for the current command.
     */
    private async loadSpec(specName: string): Promise<Fig.Spec | undefined> {
        return await loadSpec(
            specName,
            this.atLastEntry ? this.entries.slice(this.entryIndex + 1).map((e) => e.value) : []
        );
    }

    /**
     * Find a subcommand that matches the current entry and traverse it.
     * @returns True if a subcommand was found.
     */
    private async findSubcommand(): Promise<boolean> {
        const curEntry = this.currentEntry;
        if (!curEntry || this.atLastEntry) {
            return false;
        }

        log.debug("curEntry: ", curEntry, "curSpec", this.spec);

        if (this.spec) {
            // No need to run this if the user is typing an option
            // Determine if a subcommand matches the current entry, if so set it as our new spec
            const subcommand = this.spec.subcommands?.find((subcommand) => equalsAny(subcommand.name, curEntry.value));
            if (subcommand) {
                log.debug("subcommand exists", subcommand);
                // Subcommand module found; traverse it.
                switch (typeof subcommand.loadSpec) {
                    case "string": {
                        log.debug("loadSpec is string", subcommand.loadSpec);
                        // The subcommand defines a path to a new spec; load that spec and set it as our new spec
                        this.spec = await this.loadSpec(subcommand.loadSpec);
                        break;
                    }
                    case "object":
                        log.debug("loadSpec is object");
                        // The subcommand defines a new spec inline; this is our new spec
                        this.spec = {
                            ...subcommand,
                            ...(subcommand.loadSpec ?? {}),
                            loadSpec: undefined,
                        };
                        break;
                    case "function": {
                        log.debug("loadSpec is function");
                        const partSpec = await subcommand.loadSpec(curEntry.value, buildExecuteShellCommand(5000));
                        if (partSpec instanceof Array) {
                            const locationSpecs = (
                                await Promise.all(partSpec.map((s) => lazyLoadSpecLocation(s)))
                            ).filter((s) => s != null);
                            const subcommands = locationSpecs.map((s) => getSubcommand(s)).filter((s) => s != null);
                            this.spec = {
                                ...subcommand,
                                ...(subcommands.find((s) => s?.name == curEntry.value) ?? []),
                                loadSpec: undefined,
                            };
                        } else if (Object.hasOwn(partSpec, "type")) {
                            const locationSingleSpec = await lazyLoadSpecLocation(partSpec as Fig.SpecLocation);
                            this.spec = {
                                ...subcommand,
                                ...(getSubcommand(locationSingleSpec) ?? []),
                                loadSpec: undefined,
                            };
                        } else {
                            this.spec = subcommand;
                        }
                        break;
                    }
                    default:
                        // The subcommand defines options; suggest those options
                        this.spec = subcommand;
                        break;
                }
            } else {
                log.debug("subcommand not found");
                return false;
            }
        } else {
            log.debug("no spec");
            this.spec = await this.loadSpec(curEntry.value);
        }
        return true;
    }

    /**
     * Iterate through the shell entries and generate suggestions based on the matched `Fig.Spec`.
     * @returns The final list of suggestions
     */
    public async generateSuggestions(): Promise<Fig.Suggestion[]> {
        while (!this.error && !this.atEndOfEntries) {
            const newPrevState = this.curState;
            switch (this.curState) {
                case ParserState.Subcommand: {
                    log.debug("subcommand");
                    if (!(await this.findSubcommand())) {
                        switch (this.currentEntry?.type) {
                            case TokenType.FLAG:
                            case TokenType.OPTION:
                                this.curState = ParserState.Option;
                                break;
                            default:
                                this.curState = ParserState.SubcommandArgument;
                                break;
                        }
                        break;
                    }

                    this.entryIndex++;
                    break;
                }
                case ParserState.Option: {
                    log.debug("option", this.currentEntry);
                    const curEntry = this.currentEntry;
                    const isEntryOption = curEntry?.type == TokenType.OPTION;
                    const isEntryFlag = curEntry?.type == TokenType.FLAG;
                    if (this.stopInterpretingOptions) {
                        if (isEntryOption || isEntryFlag) {
                            this.error = "Options and flags are not allowed after --";
                            break;
                        } else {
                            this.curState = ParserState.SubcommandArgument;
                            break;
                        }
                    }
                    if (isEntryOption || (isEntryFlag && this.flagsArePosixNoncompliant)) {
                        log.debug("entry is option or non-posix flag");
                        this.curState = this.parseOption();
                        this.entryIndex++;
                    } else if (isEntryFlag) {
                        log.debug("entry is flag");
                        this.curState = ParserState.PosixFlag;
                        break;
                    } else {
                        log.debug("not option or flag");
                        this.curState = ParserState.SubcommandArgument;
                    }
                    break;
                }
                case ParserState.PosixFlag: {
                    log.debug("posix flag");
                    this.curState = this.parseFlag();
                    this.entryIndex++;
                    break;
                }
                case ParserState.SubcommandArgument:
                    log.debug("subcommand argument");
                    const curEntryType = this.currentEntry?.type;
                    if (
                        (curEntryType == TokenType.OPTION || curEntryType == TokenType.FLAG) &&
                        !this.optionsMustPrecedeArguments
                    ) {
                        log.debug("subcommand argument is flag or option");
                        this.curState = ParserState.Option;
                        break;
                    } else {
                        log.debug("subcommand argument is argument");
                        this.curState = await this.parseArgument();
                        this.entryIndex++;
                    }
                    break;
                case ParserState.OptionArgument:
                    log.debug("option argument");
                    this.curState = await this.parseArgument();
                    this.entryIndex++;
                    break;
            }

            // Protect against infinite loops
            if (this._numIters++ > this.entries.length * 2) {
                this.error = "Too many iterations";
            }

            this.prevState = newPrevState;

            // Bail out on error
            if (this.error) {
                console.warn("Error: " + this.error);
                break;
            }
        }

        log.debug(
            "done with loop, error: ",
            this.error,
            "entryIndex: ",
            this.entryIndex,
            "entries: ",
            this.entries,
            "curState: ",
            this.curState,
            "curOption: ",
            this.currentOption,
            "currentArgs: ",
            this.args,
            "argIndex: ",
            this.subcommandArgIndex
        );

        if (!this.error) {
            // We parsed the entire entry array without error, so we can return suggestions
            let lastEntry: Token = this.lastEntry ?? { type: TokenType.UNKNOWN, value: undefined };
            log.debug(
                "allEntries: ",
                this.entries,
                "lastEntry: ",
                `"${lastEntry}"`,
                "curState: ",
                this.curState,
                "lastEntryEndsWithSpace: ",
                lastEntry.type == TokenType.WHITESPACE
            );

            const originalCwd = this.cwd;

            // Determine the current working directory to use for file suggestions. If the last entry is a valid path, trim any directory prefixes off the entry and set the new working directory.
            if (lastEntry.type == TokenType.PATH && lastEntry.value) {
                const { cwd: resolvedCwd, pathy } = await resolveCwdToken(lastEntry, this.cwd, this.shell);
                if (pathy) {
                    this.cwd = resolvedCwd;
                    const lastEntryValue = lastEntry.value;
                    const lastSepIndex = lastEntryValue.lastIndexOf(getPathSep(this.shell));
                    if (lastSepIndex != -1) {
                        const lastEntryPathToken: PathToken = {
                            type: TokenType.PATH,
                            value: lastEntryValue.slice(lastSepIndex + 1),
                            prefix: lastEntryValue.slice(0, lastSepIndex + 1),
                        };
                        lastEntry = lastEntryPathToken;
                        this.lastEntry = lastEntry;
                    }

                    log.debug("cwd", this.cwd);
                } else {
                    lastEntry.type = TokenType.ARGUMENT;
                    this.lastEntry = lastEntry;
                }
                log.debug("resolvedCwd", resolvedCwd);
            }

            switch (this.curState) {
                case ParserState.Subcommand: {
                    log.debug("subcommands: ", this.subcommands, this.options, lastEntry);
                    // The parser never got to matching options or arguments, so suggest all available for the current spec.
                    if (lastEntry.type == TokenType.WHITESPACE) {
                        log.debug("lastEntry is space");
                        const arg = getFirst(this.spec?.args);
                        if (arg) {
                            await this.addSuggestionsForArg(arg, false);
                        }
                        if (this.spec?.additionalSuggestions) {
                            this.filterSuggestionsAndAddToMap(
                                this.spec?.additionalSuggestions.map((s) => (typeof s === "string" ? { name: s } : s)),
                                this.spec?.filterStrategy,
                                lastEntry,
                                "subcommand"
                            );
                        }
                        this.addSuggestionsForOptionsAndFlags();
                    }
                    this.addSuggestionsForSubcommands();
                    break;
                }
                case ParserState.Option:
                case ParserState.PosixFlag: {
                    log.debug("option or posix flag");
                    const availableOptions = Object.values(this.availableOptions);
                    if (lastEntry.type == TokenType.WHITESPACE) {
                        // The parser is currently matching options or subcommand arguments, so suggest all available options.
                        // TODO: this feels messy, not sure if there's a better way to do this
                        if (this.curState == ParserState.Option || !this.optionsMustPrecedeArguments) {
                            this.addSuggestionsToMap(availableOptions, "option");
                        }
                    } else {
                        switch (this.prevState) {
                            case ParserState.Option: {
                                // The parser is currently matching options, so suggest all available options.
                                const suggestionsToAdd: Fig.Suggestion[] = availableOptions.filter((option) =>
                                    startsWithAny(option.name, lastEntry.value ?? "")
                                );
                                if (this.currentOption) {
                                    suggestionsToAdd.push(this.currentOption);
                                }
                                this.addSuggestionsToMap(suggestionsToAdd, "option");
                                break;
                            }
                            case ParserState.PosixFlag: {
                                if (this.currentOption) {
                                    const existingFlags = lastEntry.value?.slice(1) ?? "";

                                    const newOption = modifyPosixFlags(this.currentOption, existingFlags);
                                    // Suggest the other available flags as additional suggestions
                                    this.addSuggestionsForOptionsAndFlags();
                                    // Push the last flag as a suggestion, in case that is as far as the user wants to go
                                    this.addSuggestionsToMap([newOption], "option");
                                } else {
                                    this.addSuggestionsToMap(availableOptions, "option");
                                }
                                break;
                            }
                            default:
                                // This should never happen.
                                break;
                        }
                    }
                    break;
                }
                case ParserState.SubcommandArgument:
                    log.debug("SubCommandArgument", "currentArgs: ", this.args, "argIndex: ", this.subcommandArgIndex);
                    // The parser is currently matching option arguments, so suggest all available arguments for the current option.
                    if (this.args && this.subcommandArgIndex < this.args.length) {
                        const arg = this.args[this.subcommandArgIndex];
                        if (arg) {
                            await this.addSuggestionsForArg(arg, false);
                        }
                    }
                    break;
                case ParserState.OptionArgument: {
                    // The parser is currently matching option arguments, so suggest all available arguments for the current option.
                    const option = this.currentOption;
                    log.debug("OptionArgument", "currentArgs: ", option.args, "argIndex: ", this.subcommandArgIndex);

                    const args = getAll(option.args);
                    const argIndex = this.optionArgIndex;
                    if (args && argIndex < args.length) {
                        const arg = args[argIndex];
                        if (arg) {
                            if (option.requiresSeparator) {
                                log.debug(
                                    "requiresSeparator",
                                    option.requiresSeparator,
                                    this.entries[this.entryIndex - 1]
                                );
                                const prefixStr =
                                    this.entries[this.entryIndex - 1] +
                                    (option.requiresSeparator === true ? "=" : option.requiresSeparator);
                                log.debug("prefixStr", prefixStr);
                                await this.addSuggestionsForArg(arg, false, prefixStr);
                            } else {
                                await this.addSuggestionsForArg(arg, false);
                            }
                        }
                    }
                    break;
                }
                default:
                    // This should never happen.
                    break;
            }

            if (this.suggestions.size == 0) {
                await this.addSuggestionsForFilepaths();
            }

            // Add history but use the original cwd, not the overridden one
            await this.addSuggestionsForHistory(originalCwd);

            const suggestionsArr = Array.from(this.suggestions.values());
            sortSuggestions(suggestionsArr);
            log.debug("suggestionsArr", suggestionsArr);
            return suggestionsArr;
        }

        return [];
    }
}
