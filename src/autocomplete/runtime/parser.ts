// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { get } from "node:http";
import log from "../utils/log";
import {
    FilterStrategy,
    generatorSuggestions,
    generatorSuggestionsTokens,
    getArgDrivenRecommendation,
    suggestionSuggestions,
    templateSuggestions,
} from "./suggestion";
import {
    buildExecuteShellCommand,
    equalsAny,
    getAll,
    getFirst,
    isFlag,
    isFlagOrOption,
    isOption,
    matchAny,
    modifyPosixFlags,
    resolveCwd,
    resolveCwdToken,
    sortSuggestions,
    startsWithAny,
} from "./utils";
import { Shell } from "../utils/shell";
import { complex } from "framer-motion";
import { getApi } from "@/models";
import { runGenerator } from "./generator";
import { runTemplates } from "./template";

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/parser.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CommandToken = {
    token: string;
    complete: boolean;
    isOption: boolean;
    isPersistent?: boolean;
    isPath?: boolean;
    isPathComplete?: boolean;
};

const cmdDelim = /(\|\|)|(&&)|(;)|(\|)/;
const spaceRegex = /\s/;

export const parseCommand = (command: string): CommandToken[] => {
    const lastCommand = command.split(cmdDelim).at(-1)?.trimStart();
    return lastCommand ? lex(lastCommand) : [];
};

const lex = (command: string): CommandToken[] => {
    const tokens: CommandToken[] = [];
    let [readingQuotedString, readingFlag, readingCmd] = [false, false, false];
    let readingIdx = 0;
    let readingQuoteChar = "";

    [...command].forEach((char, idx) => {
        const reading = readingQuotedString || readingFlag || readingCmd;
        if (!reading && (char === `'` || char === `"`)) {
            [readingQuotedString, readingIdx, readingQuoteChar] = [true, idx, char];
            return;
        } else if (!reading && char === `-`) {
            [readingFlag, readingIdx] = [true, idx];
            return;
        } else if (!reading && !spaceRegex.test(char)) {
            [readingCmd, readingIdx] = [true, idx];
            return;
        }

        if (readingQuotedString && char === readingQuoteChar && command.at(idx - 1) !== "\\") {
            readingQuotedString = false;
            const complete = idx + 1 < command.length && spaceRegex.test(command[idx + 1]);
            tokens.push({
                token: command.slice(readingIdx, idx + 1),
                complete,
                isOption: false,
            });
        } else if ((readingFlag && spaceRegex.test(char)) || char === "=") {
            readingFlag = false;
            tokens.push({
                token: command.slice(readingIdx, idx),
                complete: true,
                isOption: true,
            });
        } else if (readingCmd && spaceRegex.test(char)) {
            readingCmd = false;
            tokens.push({
                token: command.slice(readingIdx, idx),
                complete: true,
                isOption: false,
            });
        }
    });

    const reading = readingQuotedString || readingFlag || readingCmd;
    if (reading) {
        tokens.push({
            token: command.slice(readingIdx),
            complete: false,
            isOption: readingFlag,
        });
    }

    return tokens;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be implemented in below TODO
const lazyLoadSpecLocation = async (location: Fig.SpecLocation): Promise<Fig.Spec | undefined> => {
    return; //TODO: implement spec location loading
};

// TODO: handle subcommands that are versioned
const getSubcommand = (spec?: Fig.Spec): Fig.Subcommand | undefined => {
    if (spec == null) return;
    if (typeof spec === "function") {
        const potentialSubcommand = spec();
        if (Object.hasOwn(potentialSubcommand, "name")) {
            return potentialSubcommand as Fig.Subcommand;
        }
        return;
    }
    return spec;
};

// this load spec function should only be used for `loadSpec` on the fly as it is cacheless
const lazyLoadSpec = async (key: string): Promise<Fig.Spec | undefined> => {
    return (await import(`@withfig/autocomplete/build/${key}.js`)).default;
};

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
export class Parser {
    /**
     * The error message, if any.
     */
    public error: string | undefined;

    /**
     * The split segments of the current command.
     */
    public entries: string[];

    /**
     * The current index within `this.entries` that the parser is processing.
     */
    public entryIndex: number;

    /**
     * The options for the current command, as defined in the spec. A shorthand for `this.spec.options`.
     */
    public options: Fig.Option[];

    /**
     * The subcommands for the current command, as defined in the spec. A shorthand for `this.spec.subcommands`.
     */
    public subcommands: Fig.Subcommand[];

    /**
     * The most-recently-matched option. This is used to determine the final set of suggestions.
     */
    public currentOption: Fig.Option | undefined;

    /**
     * The most-recently-matched argument. This is used to determine the final set of suggestions.
     */
    public currentArgs: Fig.Arg[] | undefined;

    public argIndex: number = 0;

    public suggestions: Fig.Suggestion[] = [];

    /**
     * The available options for the current command. This is a map of option names to options. This is used to keep track of which options have already been used.
     */
    public availableOptions: { [key: string]: Fig.Option } = {};

    /**
     * A map of option names to their dependent options. This is defined in the spec as `dependsOn`. Any options present in this map will be suggested with the highest priority.
     */
    public dependentOptions: { [key: string]: Fig.Option[] } = {};

    /**
     * A map of option names to their mutually exclusive options. This is defined in the spec as `exclusiveOn`. Any options present in this map will be removed from the available options set and flagged as invalid.
     */
    public mutuallyExclusiveOptions: { [key: string]: Fig.Option[] } = {};

    /**
     * Determines whether the parser should treat flags as POSIX-compliant. This is defined in the spec as `parserDirectives.flagsArePosixNoncompliant`.
     */
    public flagsArePosixNoncompliant: boolean;

    /**
     * Determines whether options or flags can precede arguments. This is defined in the spec as `parserDirectives.optionsMustPrecedeArguments`.
     */
    public optionsMustPrecedeArguments: boolean;

    /**
     * The option argument separators to use for the current command. This is defined in the spec as `parserDirectives.optionArgSeparators`.
     * Remark: This does not appear to be widely used and most specs define argument separators in the options themselves. As this is mostly redundant, we may remove this in the future.
     */
    public optionArgSeparators: string[];

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
    public curState: ParserState = ParserState.Subcommand;

    /**
     * The previous state of the parser.
     */
    public prevState: ParserState | undefined;

    public cwd: string;

    constructor(
        spec: Fig.Subcommand | undefined,
        entries: string[],
        cwd: string,
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
        this.entries = entries ?? [];
        this.entryIndex = entryIndex;
        this.flagsArePosixNoncompliant = flagsArePosixNoncompliant;
        this.optionsMustPrecedeArguments = optionsMustPrecedeArguments;
        this.optionArgSeparators = optionArgSeparators;
        this.subcommands = subcommands;
        this.options = options;
        this.cwd = cwd;
    }

    /**
     * Get the spec for the current command.
     */
    public get spec(): Fig.Subcommand | undefined {
        return this._spec;
    }

    /**
     * Set the spec for the current command. This also sets the available options set and other parser directives, as defined in the spec.
     */
    public set spec(spec: Fig.Subcommand | undefined) {
        this._spec = spec;
        this.options = spec?.options ?? [];
        this.currentOption = undefined;
        this.currentArgs = [];
        this.argIndex = 0;
        this.suggestions = [];
        this.availableOptions = {};
        this.dependentOptions = {};
        this.subcommands = spec?.subcommands ?? [];
        this.mutuallyExclusiveOptions = {};
        this.optionsMustPrecedeArguments =
            spec?.parserDirectives?.optionsMustPrecedeArguments ?? this.optionsMustPrecedeArguments;
        this.flagsArePosixNoncompliant =
            spec?.parserDirectives?.flagsArePosixNoncompliant ?? this.flagsArePosixNoncompliant;
        this.optionArgSeparators = spec?.parserDirectives?.optionArgSeparators
            ? getAll(spec.parserDirectives?.optionArgSeparators)
            : ["="];
        for (const option of this.options) {
            for (const name of getAll(option.name)) {
                this.availableOptions[name] = option;
            }
        }
    }

    /**
     * Get an option by name from the available options set.
     * @param name The name of the option to get.
     * @returns The option, or undefined if the option is not available.
     */
    getAvailableOption(name: string): Fig.Option | undefined {
        return this.availableOptions[name];
    }

    /**
     * Checks if any of the given names have already been recorded as used.
     * @param names The names to check.
     * @returns True if any of the names have already been recorded as used.
     */
    recordedAny(names: Fig.SingleOrArray<string>): boolean {
        return !matchAny(names, (name) => this.availableOptions.hasOwnProperty(name));
    }

    /**
     * Record an option as having been used, removing it from the available options set. This should remove both the flag and the option version.
     * @param option The option to record.
     */
    recordOption(option: Fig.Option) {
        for (const name of getAll(option.name)) {
            delete this.availableOptions[name];
        }
    }

    /**
     * Gets all options that are POSIX-compliant flags.
     * @returns All options that are POSIX-compliant flags, empty array if parser directives specify that flags are POSIX-noncompliant
     */
    getAvailablePosixFlags(): Fig.Option[] {
        return this.flagsArePosixNoncompliant
            ? []
            : Object.values(this.availableOptions).filter((value) => matchAny(value.name, isFlag));
    }

    /**
     * Filters out flags from the available options if the flags are POSIX-compliant.
     * @returns All options that are not POSIX-compliant flags
     */
    getAvailableNonPosixFlags(): Fig.Option[] {
        const retVal = this.flagsArePosixNoncompliant
            ? Object.values(this.availableOptions)
            : Object.values(this.availableOptions).filter((value) => matchAny(value.name, isOption));
        return retVal;
    }

    /**
     * Identify dependent and mutually exclusive options and modify the available options set accordingly. Dependent options are given the highest priority, while exclusive options are removed from the available options set.
     * @param option The option to check.
     */
    findDependentAndExclusiveOptions(option: Fig.Option) {
        if (option.dependsOn) {
            let dependentOptions: Fig.Option[] = [];

            for (const name of option.dependsOn) {
                const dependentOption = this.getAvailableOption(name);
                if (dependentOption) {
                    // Dependent options are given the highest priority
                    dependentOptions.push(dependentOption);
                    let modifiedPriority = { ...dependentOption };
                    modifiedPriority.priority = 1000;
                    this.availableOptions[name] = modifiedPriority;
                }
            }
            for (const name of getAll(option.name)) {
                this.dependentOptions[name] = dependentOptions;
            }
        }
        if (option.exclusiveOn) {
            let mutuallyExclusiveOptions: Fig.Option[] = [];
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
     * Parses the flag in the current entry and modifies the available options set accordingly.
     */
    parseFlag() {
        const entry = this.entries.at(this.entryIndex);
        const existingFlags = entry?.slice(1);
        const flagsArr = existingFlags?.split("") ?? [];
        for (let index of flagsArr.keys()) {
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
                break;
            }
        }
    }

    /**
     * Parses the option in the current entry and modifies the available options set accordingly.
     */
    parseOption() {
        // This means we cannot use POSIX-style flags, so we have to check each option individually
        const entry = this.entries.at(this.entryIndex);
        if (!entry) {
            return;
        }

        // If the arg is not the last entry, we can check if it is a valid option
        const option = this.getAvailableOption(entry);
        if (option) {
            // If the option is available, record it and move on to the next arg
            this.recordOption(option);

            // Identify dependent and mutually exclusive options, verify that they are valid.
            this.findDependentAndExclusiveOptions(option);

            this.currentOption = option;
        } else if (this.entryIndex < this.entries.length - 1) {
            // If the option is not available, it has already been used or is not a valid option
            this.error = `The option ${entry} is not valid.`;
        } else {
            // The entry is incomplete, but it's the last one so we can just suggest all that start with the entry.
            this.currentOption = undefined;
        }
    }

    parseArgument(): ParserState {
        const entry = this.entries.at(this.entryIndex);
        if (!entry || this.currentArgs.length == 0) {
            return ParserState.Option;
        }

        const currentArg = this.currentArgs[this.argIndex];

        if (currentArg) {
            if (currentArg.isCommand) {
                // The next entry is a command, so we need to load the spec for that command and start from scratch
                this.spec = undefined;
                return ParserState.Subcommand;
            }
            if (isFlagOrOption(entry)) {
                if (!currentArg.isOptional && !currentArg.isVariadic) {
                    this.error = `The argument ${currentArg.name} is required and cannot be a flag or option.`;
                } else if (currentArg.isVariadic && currentArg.optionsCanBreakVariadicArg) {
                    if (currentArg.isVariadic) {
                        if (this.entries.length > this.entryIndex + 1) {
                            this.entryIndex++;
                            this.parseOption();
                            this.currentOption = undefined;
                            return ParserState.SubcommandArgument;
                        }
                    }
                }
                return ParserState.Option;
            } else if (currentArg.isVariadic) {
                return this.curState;
            } else {
                this.argIndex++;
                return this.curState;
            }
        } else {
            return ParserState.Option;
        }
    }

    filterSuggestions(
        suggestions: Fig.Suggestion[],
        filterStrategy: FilterStrategy,
        partialCmd: string,
        suggestionType: Fig.SuggestionType
    ): Fig.Suggestion[] {
        log.debug("filter", suggestions, filterStrategy, partialCmd, suggestionType);
        if (!partialCmd) return suggestions;

        switch (filterStrategy) {
            case "fuzzy":
                log.debug("fuzzy");
                return suggestions
                    .map((s) => {
                        if (s.name == null) return;
                        if (s.name instanceof Array) {
                            const matchedName = s.name.find((n) => n.toLowerCase().includes(partialCmd.toLowerCase()));
                            return matchedName != null ? s : undefined;
                        }
                        return s.name.toLowerCase().includes(partialCmd.toLowerCase()) ? s : undefined;
                    })
                    .filter((s) => s != null);
            default:
                return suggestions
                    .map((s) => {
                        if (s.name == null) return;
                        if (s.name instanceof Array) {
                            const matchedName = s.name.find((n) =>
                                n.toLowerCase().startsWith(partialCmd.toLowerCase())
                            );
                            return matchedName != null ? s : undefined;
                        }
                        return s.name.toLowerCase().startsWith(partialCmd.toLowerCase()) ? s : undefined;
                    })
                    .filter((s) => s != null);
        }
    }

    async getSuggestionsForArg(arg: Fig.Arg): Promise<Fig.Suggestion[]> {
        let entry = this.entries.at(this.entryIndex);

        const { cwd: resolvedCwd, pathy, complete: pathyComplete } = await resolveCwdToken(entry, this.cwd, Shell.Zsh);

        if (pathy) {
            entry = pathyComplete ? "" : getApi().pathBaseName(entry ?? "");
        }

        let suggestions: Fig.Suggestion[] = [];

        if (arg?.generators) {
            const generators = getAll(arg.generators);
            suggestions.push(
                ...(await Promise.all(generators.map((gen) => runGenerator(gen, this.entries, resolvedCwd)))).flat()
            );
        }

        if (arg?.suggestions) {
            suggestions.push(...suggestionSuggestions(arg.suggestions, arg?.filterStrategy, entry));
        }

        if (arg?.template) {
            suggestions.push(...(await runTemplates(arg.template ?? [], resolvedCwd)));
        }

        if (arg?.filterStrategy) {
            suggestions = this.filterSuggestions(
                suggestions.map((suggestion) => ({ ...suggestion, priority: suggestion.priority ?? 60 })),
                arg.filterStrategy,
                entry,
                undefined
            );
        }

        return suggestions;
    }

    getSuggestionsForSubcommands() {
        return this.filterSuggestions(
            this.subcommands,
            this.spec?.filterStrategy,
            this.entries.at(this.entryIndex),
            undefined
        );
    }

    getSuggestionsForOptions() {
        return this.filterSuggestions(
            this.options,
            this.spec?.filterStrategy,
            this.entries.at(this.entryIndex),
            undefined
        );
    }

    /**
     * Loads the spec for the current command. If the command defines a `loadSpec` function, that function is run and the result is set as the new spec. Otherwise, the spec is set to the command itself.
     * @returns The spec for the current command.
     */
    async loadSpec(specName: string): Promise<Fig.Spec | undefined> {
        try {
            log.debug("loading spec: ", specName);
            const spec = await import(`@withfig/autocomplete/build/${specName}.js`);
            if (Object.hasOwn(spec, "getVersionCommand") && typeof spec.getVersionCommand === "function") {
                console.log("has getVersionCommand fn");
                const commandVersion = await (spec.getVersionCommand as Fig.GetVersionCommand)(
                    buildExecuteShellCommand(5000)
                );
                console.log("commandVersion: " + commandVersion);
                console.log("returning as version is not supported");
                return;
            }
            if (typeof spec.default === "object") {
                const command = spec.default as Fig.Subcommand;
                console.log("Spec is valid Subcommand", command);
                if (command.generateSpec) {
                    console.log("has generateSpec function");
                    const generatedSpec = await command.generateSpec(
                        this.entryIndex < this.entries.length - 1 ? this.entries.slice(this.entryIndex + 1) : [],
                        buildExecuteShellCommand(5000)
                    );
                    console.log("generatedSpec: ", generatedSpec);
                    const newCommand: Fig.Subcommand = { ...command };

                    // Merge the generated spec with the existing spec
                    for (const key in generatedSpec) {
                        if (Array.isArray(generatedSpec[key])) {
                            newCommand[key] = [...generatedSpec[key], ...(newCommand[key] ?? [])];
                            continue;
                        } else if (typeof generatedSpec[key] === "object") {
                            newCommand[key] = { ...generatedSpec[key], ...(newCommand[key] ?? {}) };
                        } else {
                            newCommand[key] = generatedSpec[key];
                        }
                    }
                    return newCommand;
                } else {
                    console.log("no generateSpec function");
                    return command;
                }
            } else {
                this.error = "Spec is not valid Subcommand";
            }
        } catch (e) {
            console.warn("import failed: ", e);
        }
    }

    /**
     * Find a subcommand that matches the current entry and traverse it.
     * @returns True if a subcommand was found.
     */
    async findSubcommand(): Promise<boolean> {
        const curEntry = this.entries.at(this.entryIndex);
        if (!curEntry) {
            return false;
        }

        console.log("curEntry: ", curEntry);

        if (this.spec) {
            // No need to run this if the user is typing an option
            // Determine if a subcommand matches the current entry, if so set it as our new spec
            const subcommand = this.spec.subcommands?.find((subcommand) => equalsAny(subcommand.name, curEntry));
            if (subcommand) {
                // Subcommand module found; traverse it.
                switch (typeof subcommand.loadSpec) {
                    case "string": {
                        console.log("loadSpec is string", subcommand.loadSpec);
                        // The subcommand defines a path to a new spec; load that spec and set it as our new spec
                        this.spec = await this.loadSpec(subcommand.loadSpec);
                        break;
                    }
                    case "object":
                        console.log("loadSpec is object");
                        // The subcommand defines a new spec inline; this is our new spec
                        this.spec = {
                            ...subcommand,
                            ...(subcommand.loadSpec ?? {}),
                            loadSpec: undefined,
                        };
                        break;
                    case "function": {
                        console.log("loadSpec is function");
                        const partSpec = await subcommand.loadSpec(curEntry, buildExecuteShellCommand(5000));
                        if (partSpec instanceof Array) {
                            const locationSpecs = (
                                await Promise.all(partSpec.map((s) => lazyLoadSpecLocation(s)))
                            ).filter((s) => s != null) as Fig.Spec[];
                            const subcommands = locationSpecs
                                .map((s) => getSubcommand(s))
                                .filter((s) => s != null) as Fig.Subcommand[];
                            this.spec = {
                                ...subcommand,
                                ...(subcommands.find((s) => s?.name == curEntry) ?? []),
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
                return false;
            }
        } else {
            console.log("no spec");
            this.spec = await this.loadSpec(curEntry);
        }
        return true;
    }

    /**
     * Checks if the parser is at the end of the entry array.
     * @returns True if the parser is at the end of the entry array.
     */
    atEndOfEntries(): boolean {
        return this.entryIndex >= this.entries.length || this.entries.at(this.entryIndex) == " ";
    }

    /**
     * Iterate through the shell entries and generate suggestions based on the matched `Fig.Spec`.
     * @returns The final list of suggestions
     */
    async generateSuggestions(): Promise<Fig.Suggestion[]> {
        while (!this.error && !this.atEndOfEntries()) {
            this.prevState = this.curState;
            switch (this.curState) {
                case ParserState.Subcommand: {
                    console.log("subcommand");
                    if (!(await this.findSubcommand())) {
                        if (isFlagOrOption(this.entries.at(this.entryIndex) ?? "")) {
                            this.curState = ParserState.Option;
                        } else if (this.entryIndex < this.entries.length - 1) {
                            this.curState = ParserState.SubcommandArgument;
                        } else {
                            console.log("no subcommand found", this.subcommands);
                            this.entryIndex++;
                        }
                        break;
                    }

                    this.entryIndex++;
                    break;
                }
                case ParserState.Option: {
                    console.log("option");
                    const curEntry = this.entries.at(this.entryIndex) ?? "";
                    const isEntryOption = isOption(curEntry);
                    const isEntryFlag = isFlag(curEntry);
                    if (isEntryOption || (isEntryFlag && this.flagsArePosixNoncompliant)) {
                        this.parseOption();
                        this.entryIndex++;
                        if (this.currentOption?.args) {
                            this.curState = ParserState.OptionArgument;
                        }
                    } else if (isEntryFlag) {
                        this.curState = ParserState.PosixFlag;
                        break;
                    } else {
                        this.curState = ParserState.SubcommandArgument;
                    }
                    break;
                }
                case ParserState.PosixFlag: {
                    console.log("posix flag");
                    this.parseFlag();
                    this.entryIndex++;
                    if (this.currentOption?.args) {
                        this.curState = ParserState.OptionArgument;
                    } else {
                        this.curState = ParserState.Option;
                    }
                    break;
                }
                case ParserState.SubcommandArgument:
                    console.log("subcommand argument");
                    if (isFlagOrOption(this.entries.at(this.entryIndex) ?? "") && !this.optionsMustPrecedeArguments) {
                        this.curState = ParserState.Option;
                        break;
                    } else if (this.parseArgument()) {
                        this.entryIndex++;
                    }
                    break;
                case ParserState.OptionArgument:
                    console.log("option argument");
                    if (this.parseArgument()) {
                        this.entryIndex++;
                    }
                    break;
            }

            // Protect against infinite loops
            if (this._numIters++ > this.entries.length * 2) {
                this.error = "Too many iterations";
            }

            // Bail out on error
            if (this.error) {
                console.warn("Error: " + this.error);
                break;
            }
        }

        console.log(
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
            this.currentArgs,
            "argIndex: ",
            this.argIndex
        );

        if (!this.error) {
            // We parsed the entire entry array without error, so we can return suggestions
            let suggestions = new Set<Fig.Suggestion>();
            const lastEntry = this.entries.at(this.entries.length - 1);
            log.debug(
                "allEntries: ",
                this.entries,
                "lastEntry: ",
                lastEntry,
                "curState: ",
                this.curState,
                "lastEntryEndsWithSpace: ",
                lastEntry.endsWith(" ")
            );

            switch (this.curState) {
                case ParserState.Subcommand: {
                    log.debug("subcommands: ", this.subcommands, this.options, lastEntry);
                    // The parser never got to matching options or arguments, so suggest all available for the current spec.
                    if (lastEntry == " ") {
                        log.debug("lastEntry is space");
                        const arg = getFirst(this.spec?.args);
                        if (arg) {
                            (await this.getSuggestionsForArg(arg)).forEach((s) => suggestions.add(s));
                        }
                        this.spec?.additionalSuggestions?.forEach((s) =>
                            suggestions.add(typeof s === "string" ? { name: s } : s)
                        );
                        this.getSuggestionsForSubcommands().forEach((s) => suggestions.add(s));
                        this.getSuggestionsForOptions().forEach((s) => suggestions.add(s));
                    } else if (this.subcommands.length > 0) {
                        this.subcommands
                            ?.filter((subcommand) => matchAny(subcommand.name, (s) => s.startsWith(lastEntry)))
                            .forEach((subcommand) => {
                                suggestions.add(subcommand);
                            });
                    }
                    break;
                }
                case ParserState.Option:
                case ParserState.PosixFlag: {
                    const availableOptions = Object.values(this.availableOptions);
                    if (lastEntry == " ") {
                        // The parser is currently matching options or subcommand arguments, so suggest all available options.
                        // TODO: this feels messy, not sure if there's a better way to do this
                        if (this.curState == ParserState.Option || !this.optionsMustPrecedeArguments) {
                            availableOptions.forEach((option) => suggestions.add(option));
                        }
                    } else {
                        switch (this.prevState) {
                            case ParserState.Option: {
                                // The parser is currently matching options, so suggest all available options.
                                if (this.currentOption) {
                                    suggestions.add(this.currentOption);
                                }
                                availableOptions
                                    .filter((option) => startsWithAny(option.name, lastEntry ?? ""))
                                    .forEach((option) => suggestions.add(option));
                                break;
                            }
                            case ParserState.PosixFlag: {
                                if (this.currentOption) {
                                    const existingFlags = lastEntry?.slice(1) ?? "";

                                    // Push the last flag as a suggestion, in case that is as far as the user wants to go
                                    suggestions.add(modifyPosixFlags(this.currentOption, existingFlags));

                                    // Suggest the other available flags as additional suggestions
                                    availableOptions
                                        .filter((value) => matchAny(value.name, isFlag))
                                        .map((option) => modifyPosixFlags(option, existingFlags))
                                        .forEach((s) => suggestions.add(s));
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
                case ParserState.OptionArgument: {
                    console.log("currentArgs: ", this.currentArgs, "argIndex: ", this.argIndex);
                    // The parser is currently matching option arguments, so suggest all available arguments for the current option.
                    if (this.currentArgs && this.argIndex < this.currentArgs.length) {
                        const arg = this.currentArgs[this.argIndex];
                        if (arg) {
                            (await this.getSuggestionsForArg(arg)).forEach((s) => suggestions.add(s));
                        }
                    }
                    break;
                }
                default:
                    // This should never happen.
                    break;
            }

            let suggestionsArr = Array.from(suggestions);
            sortSuggestions(suggestionsArr);
            return suggestionsArr;
        }

        return [];
    }
}
