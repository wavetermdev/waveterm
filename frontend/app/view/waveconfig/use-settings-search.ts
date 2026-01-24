// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Search Hook
 *
 * A React hook for managing settings search state and filtering.
 */

import { useCallback, useMemo, useState } from "react";
import { searchSettings, SearchResult } from "./settings-search";

interface FilterState {
    onlyModified: boolean;
    category: string | null;
}

interface UseSettingsSearchResult {
    /** Current search query */
    query: string;
    /** Set the search query */
    setQuery: (query: string) => void;
    /** Search results with scores */
    results: SearchResult[];
    /** Current filter state */
    filters: FilterState;
    /** Update filter state */
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    /** Whether search is active */
    isSearching: boolean;
    /** Clear search query and reset filters */
    clearSearch: () => void;
    /** Number of results */
    resultCount: number;
}

/**
 * Hook for managing settings search state.
 *
 * @param modifiedKeys - Optional set of keys that have been modified from defaults
 * @returns Search state and controls
 */
export function useSettingsSearch(modifiedKeys?: Set<string>): UseSettingsSearchResult {
    const [query, setQuery] = useState("");
    const [filters, setFilters] = useState<FilterState>({
        onlyModified: false,
        category: null,
    });

    const results = useMemo<SearchResult[]>(() => {
        if (!query.trim() && !filters.onlyModified && !filters.category) {
            return [];
        }

        let searchResults = searchSettings(query, {
            category: filters.category || undefined,
        });

        // Apply modified filter
        if (filters.onlyModified && modifiedKeys) {
            searchResults = searchResults.filter((r) => modifiedKeys.has(r.setting.key));
        }

        return searchResults;
    }, [query, filters, modifiedKeys]);

    const clearSearch = useCallback(() => {
        setQuery("");
        setFilters({ onlyModified: false, category: null });
    }, []);

    const isSearching = query.trim().length > 0 || filters.onlyModified || filters.category !== null;

    return {
        query,
        setQuery,
        results,
        filters,
        setFilters,
        isSearching,
        clearSearch,
        resultCount: results.length,
    };
}
