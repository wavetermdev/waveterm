// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Search Module
 *
 * Provides search functionality for the settings GUI with relevance scoring.
 */

import { settingsRegistry } from "@/app/store/settings-registry";

export interface SearchResult {
    setting: SettingMetadata;
    score: number;
    matchedField: "label" | "description" | "key" | "tags";
}

export interface SearchOptions {
    onlyModified?: boolean;
    category?: string;
}

/**
 * Normalize text for search (lowercase, remove special chars)
 */
function normalize(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]/g, " ")
        .trim();
}

/**
 * Calculate match score for a query against text.
 * Higher scores indicate better matches.
 */
function getMatchScore(query: string, text: string): number {
    const normalizedQuery = normalize(query);
    const normalizedText = normalize(text);

    if (!normalizedQuery || !normalizedText) {
        return 0;
    }

    // Exact substring match gets higher score
    if (normalizedText.includes(normalizedQuery)) {
        // Starts with query gets highest score
        if (normalizedText.startsWith(normalizedQuery)) {
            return 100;
        }
        // Contains query as substring
        return 80;
    }

    // Check word matches
    const queryWords = normalizedQuery.split(" ").filter(Boolean);
    const textWords = normalizedText.split(" ").filter(Boolean);

    if (queryWords.length === 0) {
        return 0;
    }

    let matches = 0;
    for (const qw of queryWords) {
        if (textWords.some((tw) => tw.includes(qw))) {
            matches++;
        }
    }

    return matches > 0 ? (matches / queryWords.length) * 60 : 0;
}

/**
 * Search settings with relevance scoring.
 *
 * @param query - The search query string
 * @param options - Optional search options (category filter, modified filter)
 * @returns Array of search results sorted by relevance score
 */
export function searchSettings(query: string, options?: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];

    if (!query.trim()) {
        return results;
    }

    for (const [, metadata] of settingsRegistry.entries()) {
        if (metadata.hideFromSettings) continue;

        // Apply category filter
        if (options?.category && metadata.category !== options.category) {
            continue;
        }

        // Check each searchable field
        const labelScore = getMatchScore(query, metadata.label);
        const descScore = getMatchScore(query, metadata.description);
        const keyScore = getMatchScore(query, metadata.key);
        const tagScore = metadata.tags ? Math.max(...metadata.tags.map((t) => getMatchScore(query, t))) : 0;

        const maxScore = Math.max(labelScore, descScore, keyScore, tagScore);

        if (maxScore > 0) {
            let matchedField: SearchResult["matchedField"] = "label";
            if (descScore === maxScore) matchedField = "description";
            else if (keyScore === maxScore) matchedField = "key";
            else if (tagScore === maxScore) matchedField = "tags";

            results.push({ setting: metadata, score: maxScore, matchedField });
        }
    }

    // Sort by score descending
    return results.sort((a, b) => b.score - a.score);
}

/**
 * Get all settings matching a category.
 *
 * @param category - The category to filter by
 * @returns Array of settings in the category
 */
export function getSettingsByCategory(category: string): SettingMetadata[] {
    const results: SettingMetadata[] = [];

    for (const [, metadata] of settingsRegistry.entries()) {
        if (metadata.category === category) {
            results.push(metadata);
        }
    }

    return results;
}
