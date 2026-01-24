// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Visual View
 *
 * Main component that renders the visual settings interface with
 * category sidebar, search, and settings list.
 */

import { SettingControl } from "@/app/element/settings/setting-control";
import { SliderControl } from "@/app/element/settings/slider-control";
import { SelectControl } from "@/app/element/settings/select-control";
import { ToggleControl } from "@/app/element/settings/toggle-control";
import { NumberControl } from "@/app/element/settings/number-control";
import { TextControl } from "@/app/element/settings/text-control";
import { ColorControl } from "@/app/element/settings/color-control";
import { FontControl } from "@/app/element/settings/font-control";
import { PathControl } from "@/app/element/settings/path-control";
import { StringListControl } from "@/app/element/settings/stringlist-control";
import { allSettingsAtom, selectedCategoryAtom, settingsSearchQueryAtom } from "@/app/store/settings-atoms";
import {
    categoryConfigMap,
    getDefaultValue,
    getOrderedCategories,
    getSettingsByCategoryForPlatform,
    searchSettings,
} from "@/app/store/settings-registry";
import { settingsService } from "@/app/store/settings-service";
import { getApi } from "@/app/store/global";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";

import "./settings-visual.scss";

interface SettingsVisualProps {
    className?: string;
}

/**
 * Category Sidebar Component
 */
const CategorySidebar = memo(() => {
    const [selectedCategory, setSelectedCategory] = useAtom(selectedCategoryAtom);
    const orderedCategories = useMemo(() => getOrderedCategories(), []);
    const platform = getApi().getPlatform() as "darwin" | "win32" | "linux";
    const settingsByCategory = useMemo(() => getSettingsByCategoryForPlatform(platform), [platform]);

    const handleCategoryClick = useCallback(
        (category: string) => {
            setSelectedCategory(category);
            // Scroll to category section
            const element = document.getElementById(`settings-category-${category}`);
            if (element) {
                element.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        },
        [setSelectedCategory]
    );

    return (
        <div className="settings-category-sidebar">
            {orderedCategories.map((category) => {
                const config = categoryConfigMap[category];
                const settings = settingsByCategory.get(category);
                if (!settings || settings.length === 0) return null;

                return (
                    <div
                        key={category}
                        className={cn("settings-category-item", {
                            active: selectedCategory === category,
                        })}
                        onClick={() => handleCategoryClick(category)}
                    >
                        <i className={`fa fa-solid fa-${config?.icon || "cog"} category-icon`} />
                        <span className="category-name">{category}</span>
                        <span className="category-count">{settings.length}</span>
                    </div>
                );
            })}
        </div>
    );
});

CategorySidebar.displayName = "CategorySidebar";

/**
 * Search Bar Component
 */
const SearchBar = memo(() => {
    const [searchQuery, setSearchQuery] = useAtom(settingsSearchQueryAtom);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            setSearchQuery(e.target.value);
        },
        [setSearchQuery]
    );

    const handleClear = useCallback(() => {
        setSearchQuery("");
        inputRef.current?.focus();
    }, [setSearchQuery]);

    return (
        <div className="settings-search">
            <i className="fa fa-solid fa-search search-icon" />
            <input
                ref={inputRef}
                type="text"
                placeholder="Search settings..."
                value={searchQuery}
                onChange={handleChange}
            />
            {searchQuery && (
                <button className="clear-button" onClick={handleClear} type="button">
                    <i className="fa fa-solid fa-times" />
                </button>
            )}
        </div>
    );
});

SearchBar.displayName = "SearchBar";

/**
 * Render the appropriate control component based on setting metadata
 */
function renderControl(
    metadata: SettingMetadata,
    value: unknown,
    onChange: (value: unknown) => void
): React.ReactNode {
    switch (metadata.controlType) {
        case "toggle":
            return <ToggleControl value={Boolean(value)} onChange={onChange} />;

        case "slider":
            return (
                <SliderControl
                    value={(value as number) ?? (metadata.defaultValue as number) ?? 0}
                    onChange={onChange}
                    min={metadata.validation?.min}
                    max={metadata.validation?.max}
                    step={metadata.validation?.step}
                />
            );

        case "number":
            return (
                <NumberControl
                    value={(value as number) ?? (metadata.defaultValue as number) ?? 0}
                    onChange={onChange}
                    min={metadata.validation?.min}
                    max={metadata.validation?.max}
                    step={metadata.validation?.step}
                />
            );

        case "select":
            return (
                <SelectControl
                    value={(value as string) ?? ""}
                    onChange={onChange}
                    options={metadata.validation?.options || []}
                    placeholder="Select..."
                />
            );

        case "text":
            return (
                <TextControl
                    value={(value as string) ?? ""}
                    onChange={onChange}
                    pattern={metadata.validation?.pattern}
                />
            );

        case "color":
            return <ColorControl value={(value as string) ?? ""} onChange={onChange} />;

        case "font":
            return <FontControl value={(value as string) ?? ""} onChange={onChange} />;

        case "path":
            return <PathControl value={(value as string) ?? ""} onChange={onChange} />;

        case "stringlist":
            return <StringListControl value={(value as string[]) ?? []} onChange={onChange} />;

        default:
            return (
                <TextControl
                    value={typeof value === "string" ? value : JSON.stringify(value) ?? ""}
                    onChange={onChange}
                />
            );
    }
}

/**
 * Setting Row Component
 */
interface SettingRowProps {
    metadata: SettingMetadata;
}

const SettingRow = memo(({ metadata }: SettingRowProps) => {
    const allSettings = useAtomValue(allSettingsAtom);
    const value = allSettings[metadata.key];
    const defaultValue = getDefaultValue(metadata.key);

    const isModified = useMemo(() => {
        if (value === undefined || value === null) {
            return false;
        }
        if (Array.isArray(value) && Array.isArray(defaultValue)) {
            if (value.length !== defaultValue.length) return true;
            return value.some((v, i) => v !== defaultValue[i]);
        }
        return value !== defaultValue;
    }, [value, defaultValue]);

    const handleChange = useCallback(
        (newValue: unknown) => {
            settingsService.setSetting(metadata.key, newValue);
        },
        [metadata.key]
    );

    return (
        <SettingControl
            settingKey={metadata.key}
            label={metadata.label}
            description={metadata.description}
            value={value as boolean | number | string | string[] | null}
            defaultValue={defaultValue}
            onChange={handleChange}
            isModified={isModified}
            requiresRestart={metadata.requiresRestart}
        >
            {renderControl(metadata, value, handleChange)}
        </SettingControl>
    );
});

SettingRow.displayName = "SettingRow";

/**
 * Settings List Component
 */
const SettingsList = memo(() => {
    const searchQuery = useAtomValue(settingsSearchQueryAtom);
    const platform = getApi().getPlatform() as "darwin" | "win32" | "linux";
    const settingsByCategory = useMemo(() => getSettingsByCategoryForPlatform(platform), [platform]);
    const orderedCategories = useMemo(() => getOrderedCategories(), []);

    // Handle search results
    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) {
            return null;
        }
        return searchSettings(searchQuery);
    }, [searchQuery]);

    // Render search results
    if (searchResults) {
        if (searchResults.length === 0) {
            return (
                <div className="settings-empty">
                    <i className="fa fa-solid fa-search empty-icon" />
                    <span className="empty-text">No settings found for "{searchQuery}"</span>
                </div>
            );
        }

        return (
            <div className="settings-list">
                <div className="settings-search-results-header">
                    {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{searchQuery}"
                </div>
                {searchResults.map((result) => (
                    <SettingRow key={result.key} metadata={result} />
                ))}
            </div>
        );
    }

    // Render categorized settings
    return (
        <div className="settings-list">
            {orderedCategories.map((category) => {
                const settings = settingsByCategory.get(category);
                if (!settings || settings.length === 0) return null;

                const config = categoryConfigMap[category];

                // Group by subcategory
                const bySubcategory = new Map<string | undefined, SettingMetadata[]>();
                for (const setting of settings) {
                    const sub = setting.subcategory;
                    if (!bySubcategory.has(sub)) {
                        bySubcategory.set(sub, []);
                    }
                    bySubcategory.get(sub)!.push(setting);
                }

                return (
                    <div key={category} id={`settings-category-${category}`} className="settings-category-section">
                        <div className="settings-category-header">
                            <i className={`fa fa-solid fa-${config?.icon || "cog"} category-icon`} />
                            {category}
                        </div>
                        {Array.from(bySubcategory.entries()).map(([subcategory, subSettings]) => (
                            <div key={subcategory ?? "default"}>
                                {subcategory && <div className="settings-subcategory-header">{subcategory}</div>}
                                {subSettings.map((setting) => (
                                    <SettingRow key={setting.key} metadata={setting} />
                                ))}
                            </div>
                        ))}
                    </div>
                );
            })}
        </div>
    );
});

SettingsList.displayName = "SettingsList";

/**
 * Main Settings Visual Component
 */
export const SettingsVisual = memo(({ className }: SettingsVisualProps) => {
    const searchQuery = useAtomValue(settingsSearchQueryAtom);

    // Initialize settings service on mount
    useEffect(() => {
        settingsService.initialize().catch(console.error);
    }, []);

    return (
        <div className={cn("settings-visual", className)}>
            <div className="settings-visual-header">
                <SearchBar />
            </div>
            <div className="settings-visual-body">
                {!searchQuery && <CategorySidebar />}
                <SettingsList />
            </div>
        </div>
    );
});

SettingsVisual.displayName = "SettingsVisual";
