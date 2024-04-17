// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/runtime/suggestion.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandToken } from "./parser";
import { runGenerator } from "./generator";
import { runTemplates } from "./template";
import { Suggestion, SuggestionBlob } from "./model";
import { getApi } from "@/models";
import log from "../utils/log";
import { getAll, matchAny } from "./utils";

enum SuggestionIcons {
    File = "📄",
    Folder = "📁",
    Subcommand = "📦",
    Option = "🔗",
    Argument = "💲",
    Mixin = "🏝️",
    Shortcut = "🔥",
    Special = "⭐",
    Default = "📀",
}

const getIcon = (icon: string | undefined, suggestionType: Fig.SuggestionType | undefined): string => {
    // TODO: enable fig icons once spacing is better
    // if (icon && /[^\u0000-\u00ff]/.test(icon)) {
    //   return icon;
    // }
    switch (suggestionType) {
        case "arg":
            return SuggestionIcons.Argument;
        case "file":
            return SuggestionIcons.File;
        case "folder":
            return SuggestionIcons.Folder;
        case "option":
            return SuggestionIcons.Option;
        case "subcommand":
            return SuggestionIcons.Subcommand;
        case "mixin":
            return SuggestionIcons.Mixin;
        case "shortcut":
            return SuggestionIcons.Shortcut;
        case "special":
            return SuggestionIcons.Special;
    }
    return SuggestionIcons.Default;
};

const getLong = (suggestion: Fig.SingleOrArray<string>): string => {
    return suggestion instanceof Array ? suggestion.reduce((p, c) => (p.length > c.length ? p : c)) : suggestion;
};

const toSuggestion = (suggestion: Fig.Suggestion, name?: string, type?: Fig.SuggestionType): Suggestion | undefined => {
    if (suggestion.name == null) return;
    return {
        name: name ?? getLong(suggestion.name),
        description: suggestion.description,
        icon: getIcon(suggestion.icon, type ?? suggestion.type),
        allNames: suggestion.name instanceof Array ? suggestion.name : [suggestion.name],
        priority: suggestion.priority ?? 50,
        insertValue: suggestion.insertValue,
    };
};

function filter<
    T extends Fig.BaseSuggestion & { name?: Fig.SingleOrArray<string>; type?: Fig.SuggestionType | undefined }
>(
    suggestions: T[],
    filterStrategy: FilterStrategy | undefined,
    partialCmd: string | undefined,
    suggestionType: Fig.SuggestionType | undefined
): Fig.Suggestion[] {
    log.debug("filter", suggestions, filterStrategy, partialCmd, suggestionType);
    if (!partialCmd)
        return suggestions
            .map((s) => toSuggestion(s, undefined, suggestionType))
            .filter((s) => s != null) as Suggestion[];

    switch (filterStrategy) {
        case "fuzzy":
            log.debug("fuzzy");
            return suggestions
                .map((s) => {
                    if (s.name == null) return;
                    if (s.name instanceof Array) {
                        const matchedName = s.name.find((n) => n.toLowerCase().includes(partialCmd.toLowerCase()));
                        return matchedName != null
                            ? {
                                  name: matchedName,
                                  description: s.description,
                                  icon: getIcon(s.icon, s.type ?? suggestionType),
                                  allNames: s.name,
                                  priority: s.priority ?? 50,
                                  insertValue: s.insertValue,
                              }
                            : undefined;
                    }
                    return s.name.toLowerCase().includes(partialCmd.toLowerCase())
                        ? {
                              name: s.name,
                              description: s.description,
                              icon: getIcon(s.icon, s.type ?? suggestionType),
                              allNames: [s.name],
                              priority: s.priority ?? 50,
                              insertValue: s.insertValue,
                          }
                        : undefined;
                })
                .filter((s) => s != null) as Suggestion[];
        default:
            return suggestions
                .map((s) => {
                    if (s.name == null) return;
                    if (s.name instanceof Array) {
                        const matchedName = s.name.find((n) => n.toLowerCase().startsWith(partialCmd.toLowerCase()));
                        return matchedName != null
                            ? {
                                  name: matchedName,
                                  description: s.description,
                                  icon: getIcon(s.icon, s.type ?? suggestionType),
                                  allNames: s.name,
                                  insertValue: s.insertValue,
                                  priority: s.priority ?? 50,
                              }
                            : undefined;
                    }
                    return s.name.toLowerCase().startsWith(partialCmd.toLowerCase())
                        ? {
                              name: s.name,
                              description: s.description,
                              icon: getIcon(s.icon, s.type ?? suggestionType),
                              allNames: [s.name],
                              insertValue: s.insertValue,
                              priority: s.priority ?? 50,
                          }
                        : undefined;
                })
                .filter((s) => s != null) as Suggestion[];
    }
}

export type FilterStrategy = "fuzzy" | "prefix" | "default";

export const generatorSuggestionsTokens = async (
    generator: Fig.SingleOrArray<Fig.Generator> | undefined,
    tokens: string[],
    filterStrategy: FilterStrategy | undefined,
    partialCmd: string | undefined,
    cwd: string
) => {
    const generators = generator instanceof Array ? generator : generator ? [generator] : [];
    const suggestions = (await Promise.all(generators.map((gen) => runGenerator(gen, tokens, cwd)))).flat();
    return filter<Fig.Suggestion>(
        suggestions.map((suggestion) => ({ ...suggestion, priority: suggestion.priority ?? 60 })),
        filterStrategy,
        partialCmd,
        undefined
    );
};

export const generatorSuggestions = async (
    generator: Fig.SingleOrArray<Fig.Generator> | undefined,
    acceptedTokens: CommandToken[],
    filterStrategy: FilterStrategy | undefined,
    partialCmd: string | undefined,
    cwd: string
): Promise<Fig.Suggestion[]> => {
    const generators = generator instanceof Array ? generator : generator ? [generator] : [];
    const tokens = acceptedTokens.map((t) => t.token);
    if (partialCmd) tokens.push(partialCmd);
    return generatorSuggestionsTokens(generators, tokens, filterStrategy, partialCmd, cwd);
};

export const templateSuggestions = async (
    templates: Fig.Template | undefined,
    filterStrategy: FilterStrategy | undefined,
    partialCmd: string | undefined,
    cwd: string
): Promise<Fig.Suggestion[]> => {
    log.debug("templateSuggestions", templates, filterStrategy, partialCmd);
    return filter<Fig.Suggestion>(await runTemplates(templates ?? [], cwd), filterStrategy, partialCmd, undefined);
};

export const suggestionSuggestions = (
    suggestions: (string | Fig.Suggestion)[] | undefined,
    filterStrategy: FilterStrategy | undefined,
    partialCmd: string | undefined
): Fig.Suggestion[] => {
    const cleanedSuggestions = suggestions?.map((s) => (typeof s === "string" ? { name: s } : s)) ?? [];
    return filter<Fig.Suggestion>(cleanedSuggestions ?? [], filterStrategy, partialCmd, undefined);
};

export const subcommandSuggestions = (
    subcommands: Fig.Subcommand[] | undefined,
    filterStrategy: FilterStrategy | undefined,
    partialCmd: string | undefined
): Fig.Suggestion[] => {
    return filter<Fig.Subcommand>(subcommands ?? [], filterStrategy, partialCmd, "subcommand");
};

const optionSuggestions = (
    options: Fig.Option[] | undefined,
    acceptedTokens: CommandToken[],
    filterStrategy: FilterStrategy | undefined,
    partialCmd: string | undefined
): Fig.Suggestion[] => {
    log.debug("optionSuggestions", options, acceptedTokens, filterStrategy, partialCmd);
    const usedOptions = new Set(acceptedTokens.filter((t) => t.isOption).map((t) => t.token));
    const validOptions = options?.filter(
        (o) => o.exclusiveOn?.every((exclusiveOption) => !usedOptions.has(exclusiveOption)) ?? true
    );
    return filter<Fig.Option>(validOptions ?? [], filterStrategy, partialCmd, "option");
};

const removeAcceptedSuggestions = (suggestions: Fig.Suggestion[], acceptedTokens: CommandToken[]): Fig.Suggestion[] => {
    const seen = new Set<string>(acceptedTokens.map((t) => t.token));
    return suggestions.filter((s) => matchAny(s.name, (n) => !seen.has(n)));
};

const removeDuplicateSuggestion = (suggestions: Fig.Suggestion[]): Fig.Suggestion[] => {
    const seen = new Set<string>();
    return suggestions
        .map((s) => {
            if (matchAny(s.name, (n) => seen.has(n))) return null;
            for (const name of s.name) seen.add(name);
            return s;
        })
        .filter((s): s is Fig.Suggestion => s != null);
};

const removeEmptySuggestion = (suggestions: Fig.Suggestion[]): Fig.Suggestion[] => {
    return suggestions.filter((s) => s.name.length > 0);
};

export const getSubcommandDrivenRecommendation = async (
    subcommand: Fig.Subcommand,
    persistentOptions: Fig.Option[],
    partialToken: CommandToken | undefined,
    argsDepleted: boolean,
    argsFromSubcommand: boolean,
    acceptedTokens: CommandToken[],
    cwd: string
): Promise<SuggestionBlob | undefined> => {
    log.debug("getSubcommandDrivenRecommendation", subcommand, partialToken, argsDepleted, argsFromSubcommand);
    // if (argsDepleted && argsFromSubcommand) {
    //     log.debug("argsDepleted && argsFromSubcommand");
    //     return;
    // }
    let partialCmd = partialToken?.token ?? "";
    if (partialToken?.isPath) {
        log.debug("partialToken?.isPath");
        partialCmd = partialToken.isPathComplete ? "" : getApi().pathBaseName(partialCmd ?? "");
    }

    const suggestions: Fig.Suggestion[] = [];
    const argLength = subcommand.args instanceof Array ? subcommand.args.length : subcommand.args ? 1 : 0;
    const allOptions = persistentOptions.concat(subcommand.options ?? []);
    log.debug("allOptions", allOptions, persistentOptions, subcommand.options, subcommand.args, argLength);

    if (!argsFromSubcommand) {
        log.debug("!argsFromSubcommand");
        suggestions.push(...subcommandSuggestions(subcommand.subcommands, subcommand.filterStrategy, partialCmd));
        log.debug("suggestions", suggestions);
        suggestions.push(...optionSuggestions(allOptions, acceptedTokens, subcommand.filterStrategy, partialCmd));
        log.debug("suggestions", suggestions);
    }
    if (argLength != 0) {
        log.debug("argLength != 0");
        const activeArg = subcommand.args instanceof Array ? subcommand.args[0] : subcommand.args;
        suggestions.push(
            ...(await generatorSuggestions(
                activeArg?.generators,
                acceptedTokens,
                activeArg?.filterStrategy,
                partialCmd,
                cwd
            ))
        );
        log.debug("suggestions", suggestions);
        suggestions.push(...suggestionSuggestions(activeArg?.suggestions, activeArg?.filterStrategy, partialCmd));
        log.debug("suggestions", suggestions);
        suggestions.push(
            ...(await templateSuggestions(activeArg?.template, activeArg?.filterStrategy, partialCmd, cwd))
        );
        log.debug("suggestions", suggestions);
    }

    suggestions.push(...(await templateSuggestions("history", "prefix", null, cwd)));
    log.debug("suggestions return", suggestions);

    return {
        suggestions: removeDuplicateSuggestion(
            removeEmptySuggestion(
                removeAcceptedSuggestions(
                    suggestions.sort((a, b) => b.priority - a.priority),
                    acceptedTokens
                )
            )
        ),
    };
};

export const getArgDrivenRecommendation = async (
    args: Fig.Arg[],
    subcommand: Fig.Subcommand,
    persistentOptions: Fig.Option[],
    partialToken: CommandToken | undefined,
    acceptedTokens: CommandToken[],
    variadicArgBound: boolean,
    cwd: string
): Promise<SuggestionBlob | undefined> => {
    let partialCmd = partialToken?.token;
    if (partialToken?.isPath) {
        partialCmd = partialToken.isPathComplete ? "" : getApi().pathBaseName(partialCmd ?? "");
    }

    const activeArg = args[0];
    const allOptions = persistentOptions.concat(subcommand.options ?? []);
    const suggestions = [
        ...(await generatorSuggestions(args[0].generators, acceptedTokens, activeArg?.filterStrategy, partialCmd, cwd)),
        ...suggestionSuggestions(args[0].suggestions, activeArg?.filterStrategy, partialCmd),
        ...(await templateSuggestions(args[0].template, activeArg?.filterStrategy, partialCmd, cwd)),
    ];

    if (activeArg.isOptional || (activeArg.isVariadic && variadicArgBound)) {
        suggestions.push(...subcommandSuggestions(subcommand.subcommands, activeArg?.filterStrategy, partialCmd));
        suggestions.push(...optionSuggestions(allOptions, acceptedTokens, activeArg?.filterStrategy, partialCmd));
    }

    return {
        suggestions: removeDuplicateSuggestion(
            removeEmptySuggestion(
                removeAcceptedSuggestions(
                    suggestions.sort((a, b) => b.priority - a.priority),
                    acceptedTokens
                )
            )
        ),
        argumentDescription: activeArg.description ?? activeArg.name,
    };
};
