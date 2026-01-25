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
import { SelectControl, SelectOption } from "@/app/element/settings/select-control";
import { ToggleControl } from "@/app/element/settings/toggle-control";
import { NumberControl } from "@/app/element/settings/number-control";
import { TextControl } from "@/app/element/settings/text-control";
import { ColorControl } from "@/app/element/settings/color-control";
import { FontControl } from "@/app/element/settings/font-control";
import { PathControl } from "@/app/element/settings/path-control";
import { StringListControl } from "@/app/element/settings/stringlist-control";
import {
    allSettingsAtom,
    selectedCategoryAtom,
    selectedSubcategoryAtom,
    settingsSearchQueryAtom,
} from "@/app/store/settings-atoms";
import {
    categoryConfigMap,
    getDefaultValue,
    getOrderedCategories,
    getSettingMetadata,
    getSettingsByCategoryForPlatform,
    getSubcategoriesForCategory,
    searchSettings,
} from "@/app/store/settings-registry";
import { settingsService } from "@/app/store/settings-service";
import { termThemesProvider, aiModeProvider } from "@/app/store/settings-options-provider";
import { getApi } from "@/app/store/global";
import { cn } from "@/util/util";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { atom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./settings-visual.scss";

/**
 * Navigate to a setting by key and highlight it.
 * Used for cross-linking between related settings.
 */
function navigateToSetting(settingKey: string): void {
    // Clear search so we can navigate to the full settings list
    // The search query atom will be updated via the callback if needed

    // Get the setting metadata to find its category
    const metadata = getSettingMetadata(settingKey);
    if (!metadata) {
        console.warn(`Setting not found: ${settingKey}`);
        return;
    }

    // Find the setting row element
    const settingRow = document.querySelector(`[data-setting-key="${settingKey}"]`);
    const container = document.querySelector(".settings-list");

    if (settingRow && container) {
        // Scroll the setting into view
        const containerRect = container.getBoundingClientRect();
        const rowRect = settingRow.getBoundingClientRect();
        const scrollOffset = rowRect.top - containerRect.top + container.scrollTop - 60; // 60px offset for header

        container.scrollTo({ top: scrollOffset, behavior: "smooth" });

        // Add highlight class after scroll completes
        setTimeout(() => {
            settingRow.classList.add("highlight");
            // Remove highlight class after animation completes
            setTimeout(() => {
                settingRow.classList.remove("highlight");
            }, 1500);
        }, 300);
    } else {
        // Setting might be in a different category - scroll to category first
        const categoryElement = document.getElementById(`settings-category-${metadata.category}`);
        if (categoryElement && container) {
            const containerRect = container.getBoundingClientRect();
            const categoryRect = categoryElement.getBoundingClientRect();
            const scrollOffset = categoryRect.top - containerRect.top + container.scrollTop;

            container.scrollTo({ top: scrollOffset, behavior: "smooth" });

            // After scrolling to category, try to find and highlight the setting
            setTimeout(() => {
                const settingRowRetry = document.querySelector(`[data-setting-key="${settingKey}"]`);
                if (settingRowRetry) {
                    settingRowRetry.classList.add("highlight");
                    setTimeout(() => {
                        settingRowRetry.classList.remove("highlight");
                    }, 1500);
                }
            }, 500);
        }
    }
}

/**
 * Component that renders setting description with clickable links.
 * Parses the description text and converts linked phrases into clickable elements.
 */
interface SettingDescriptionProps {
    description: string;
    links?: Record<string, string>;
    onNavigate?: (settingKey: string) => void;
}

const SettingDescription = memo(({ description, links, onNavigate }: SettingDescriptionProps) => {
    // If no links, just return the description as-is
    if (!links || Object.keys(links).length === 0) {
        return <>{description}</>;
    }

    // Build a regex to match all link phrases (case-insensitive)
    const linkPhrases = Object.keys(links);
    // Sort by length (longest first) to match longer phrases first
    linkPhrases.sort((a, b) => b.length - a.length);

    // Escape special regex characters in phrases
    const escapedPhrases = linkPhrases.map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regex = new RegExp(`(${escapedPhrases.join("|")})`, "gi");

    // Split description by link phrases
    const parts = description.split(regex);

    const handleClick = useCallback(
        (settingKey: string) => {
            if (onNavigate) {
                onNavigate(settingKey);
            } else {
                navigateToSetting(settingKey);
            }
        },
        [onNavigate]
    );

    return (
        <>
            {parts.map((part, index) => {
                // Check if this part is a link phrase (case-insensitive match)
                const linkKey = linkPhrases.find((phrase) => phrase.toLowerCase() === part.toLowerCase());
                if (linkKey) {
                    const targetSettingKey = links[linkKey];
                    return (
                        <span
                            key={index}
                            className="setting-link"
                            onClick={() => handleClick(targetSettingKey)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    handleClick(targetSettingKey);
                                }
                            }}
                        >
                            {part}
                        </span>
                    );
                }
                return <span key={index}>{part}</span>;
            })}
        </>
    );
});

SettingDescription.displayName = "SettingDescription";

interface SettingsVisualProps {
    className?: string;
}

/**
 * Category Sidebar Component - Tree structure with expandable categories
 */
const CategorySidebar = memo(() => {
    const [selectedCategory, setSelectedCategory] = useAtom(selectedCategoryAtom);
    const [selectedSubcategory, setSelectedSubcategory] = useAtom(selectedSubcategoryAtom);
    const orderedCategories = useMemo(() => getOrderedCategories(), []);
    const platform = getApi().getPlatform() as "darwin" | "win32" | "linux";
    const settingsByCategory = useMemo(() => getSettingsByCategoryForPlatform(platform), [platform]);

    // Get subcategories for each category
    const subcategoriesByCategory = useMemo(() => {
        const result = new Map<string, string[]>();
        for (const category of orderedCategories) {
            result.set(category, getSubcategoriesForCategory(category, platform));
        }
        return result;
    }, [orderedCategories, platform]);

    const handleCategoryClick = useCallback(
        (category: string) => {
            setSelectedCategory(category);
            setSelectedSubcategory(null);
            // Scroll to category section within the settings-list container
            const element = document.getElementById(`settings-category-${category}`);
            const container = document.querySelector(".settings-list");
            if (element && container) {
                const containerRect = container.getBoundingClientRect();
                const elementRect = element.getBoundingClientRect();
                const scrollOffset = elementRect.top - containerRect.top + container.scrollTop;
                container.scrollTo({ top: scrollOffset, behavior: "smooth" });
            }
        },
        [setSelectedCategory, setSelectedSubcategory]
    );

    const handleSubcategoryClick = useCallback(
        (category: string, subcategory: string, e: React.MouseEvent) => {
            e.stopPropagation();
            setSelectedCategory(category);
            setSelectedSubcategory(subcategory);
            // Scroll to subcategory section
            const element = document.getElementById(`settings-subcategory-${category}-${subcategory}`);
            const container = document.querySelector(".settings-list");
            if (element && container) {
                const containerRect = container.getBoundingClientRect();
                const elementRect = element.getBoundingClientRect();
                // Offset for the sticky category header (~38px)
                const scrollOffset = elementRect.top - containerRect.top + container.scrollTop - 38;
                container.scrollTo({ top: scrollOffset, behavior: "smooth" });
            }
        },
        [setSelectedCategory, setSelectedSubcategory]
    );

    return (
        <div className="settings-category-sidebar">
            {orderedCategories.map((category) => {
                const config = categoryConfigMap[category];
                const settings = settingsByCategory.get(category);
                if (!settings || settings.length === 0) return null;

                const subcategories = subcategoriesByCategory.get(category) || [];
                const isExpanded = selectedCategory === category;
                const hasSubcategories = subcategories.length > 0;

                return (
                    <div key={category} className="settings-category-tree-item">
                        <div
                            className={cn("settings-category-item", {
                                active: isExpanded,
                                expanded: isExpanded && hasSubcategories,
                            })}
                            onClick={() => handleCategoryClick(category)}
                        >
                            {hasSubcategories && (
                                <i
                                    className={cn("fa fa-solid tree-chevron", {
                                        "fa-chevron-down": isExpanded,
                                        "fa-chevron-right": !isExpanded,
                                    })}
                                />
                            )}
                            {!hasSubcategories && <span className="tree-chevron-spacer" />}
                            <i className={`fa fa-solid fa-${config?.icon || "cog"} category-icon`} />
                            <span className="category-name">{category}</span>
                            <span className="category-count">{settings.length}</span>
                        </div>
                        {isExpanded && hasSubcategories && (
                            <div className="settings-subcategory-list">
                                {subcategories.map((subcategory) => (
                                    <div
                                        key={subcategory}
                                        className={cn("settings-subcategory-item", {
                                            active: selectedSubcategory === subcategory,
                                        })}
                                        onClick={(e) => handleSubcategoryClick(category, subcategory, e)}
                                    >
                                        <span className="subcategory-name">{subcategory}</span>
                                    </div>
                                ))}
                            </div>
                        )}
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
 * Map of setting keys to their dynamic options providers.
 * These settings have options that need to be loaded at runtime.
 */
const dynamicOptionsMap: Record<string, () => Promise<SelectOption[]>> = {
    "term:theme": () => termThemesProvider.getOptions(),
    "waveai:defaultmode": () => aiModeProvider.getOptions(),
    "ai:preset": () => aiModeProvider.getOptions(),
};

/**
 * Hook to get options for a select control, handling both static and dynamic options.
 */
function useDynamicOptions(settingKey: string, staticOptions?: SelectOption[]): SelectOption[] {
    const [dynamicOptions, setDynamicOptions] = useState<SelectOption[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        // If we already have static options, use them
        if (staticOptions && staticOptions.length > 0) {
            setDynamicOptions(staticOptions);
            setLoaded(true);
            return;
        }

        // Check if this setting needs dynamic options
        const provider = dynamicOptionsMap[settingKey];
        if (provider) {
            provider()
                .then((options) => {
                    setDynamicOptions(options);
                    setLoaded(true);
                })
                .catch((err) => {
                    console.error(`Failed to load options for ${settingKey}:`, err);
                    setLoaded(true);
                });
        } else {
            setLoaded(true);
        }
    }, [settingKey, staticOptions]);

    return dynamicOptions;
}

/**
 * Render the appropriate control component based on setting metadata
 */
function renderControl(
    metadata: SettingMetadata,
    value: unknown,
    onChange: (value: unknown) => void,
    dynamicOptions?: SelectOption[]
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

        case "select": {
            // Use dynamic options if provided and static options are empty
            const options = dynamicOptions && dynamicOptions.length > 0
                ? dynamicOptions
                : (metadata.validation?.options || []);
            return (
                <SelectControl
                    value={(value as string) ?? ""}
                    onChange={onChange}
                    options={options}
                    placeholder="Select..."
                />
            );
        }

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
    const setSearchQuery = useSetAtom(settingsSearchQueryAtom);
    const value = allSettings[metadata.key];
    const defaultValue = getDefaultValue(metadata.key);

    // Load dynamic options for select controls
    const staticOptions = metadata.validation?.options as SelectOption[] | undefined;
    const dynamicOptions = useDynamicOptions(metadata.key, staticOptions);

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

    // Handle navigation to linked settings - clear search first
    const handleNavigate = useCallback(
        (settingKey: string) => {
            // Clear search so the target setting is visible
            setSearchQuery("");
            // Small delay to let React re-render before navigating
            setTimeout(() => {
                navigateToSetting(settingKey);
            }, 50);
        },
        [setSearchQuery]
    );

    // Render description with links if present
    const descriptionContent = metadata.links ? (
        <SettingDescription
            description={metadata.description}
            links={metadata.links}
            onNavigate={handleNavigate}
        />
    ) : (
        metadata.description
    );

    return (
        <SettingControl
            settingKey={metadata.key}
            label={metadata.label}
            description={descriptionContent}
            value={value as boolean | number | string | string[] | null}
            defaultValue={defaultValue}
            onChange={handleChange}
            isModified={isModified}
            requiresRestart={metadata.requiresRestart}
        >
            {renderControl(metadata, value, handleChange, dynamicOptions)}
        </SettingControl>
    );
});

SettingRow.displayName = "SettingRow";

/**
 * Settings List Component
 */
const SettingsList = memo(() => {
    const searchQuery = useAtomValue(settingsSearchQueryAtom);
    const [, setSelectedCategory] = useAtom(selectedCategoryAtom);
    const [, setSelectedSubcategory] = useAtom(selectedSubcategoryAtom);
    const platform = getApi().getPlatform() as "darwin" | "win32" | "linux";
    const settingsByCategory = useMemo(() => getSettingsByCategoryForPlatform(platform), [platform]);
    const orderedCategories = useMemo(() => getOrderedCategories(), []);
    const listRef = useRef<HTMLDivElement>(null);

    // Scroll-spy: Update sidebar selection when scrolling through categories and subcategories
    useEffect(() => {
        if (searchQuery.trim()) {
            // Don't run scroll-spy during search
            return;
        }

        const container = listRef.current;
        if (!container) return;

        const handleScroll = () => {
            const containerRect = container.getBoundingClientRect();
            const containerTop = containerRect.top;

            // Find the topmost visible category
            const categoryElements = container.querySelectorAll("[id^='settings-category-']");
            let currentCategory: string | null = null;

            for (const element of categoryElements) {
                const rect = element.getBoundingClientRect();
                // Category is current if its top is at or above container top + some margin
                if (rect.top <= containerTop + 60 && rect.bottom > containerTop + 60) {
                    const match = element.id.match(/^settings-category-(.+)$/);
                    if (match) {
                        currentCategory = match[1];
                    }
                }
            }

            if (currentCategory) {
                setSelectedCategory(currentCategory);

                // Find the topmost visible subcategory within this category
                const subcategoryElements = container.querySelectorAll(
                    `[id^='settings-subcategory-${currentCategory}-']`
                );
                let currentSubcategory: string | null = null;

                for (const element of subcategoryElements) {
                    const rect = element.getBoundingClientRect();
                    // Subcategory is current if its top is at or above container top + header offset
                    if (rect.top <= containerTop + 100 && rect.bottom > containerTop + 100) {
                        const match = element.id.match(/^settings-subcategory-[^-]+-(.+)$/);
                        if (match) {
                            currentSubcategory = match[1];
                        }
                    }
                }

                setSelectedSubcategory(currentSubcategory);
            }
        };

        // Initial check
        handleScroll();

        // Update on scroll
        container.addEventListener("scroll", handleScroll, { passive: true });

        return () => {
            container.removeEventListener("scroll", handleScroll);
        };
    }, [searchQuery, setSelectedCategory, setSelectedSubcategory]);

    // Sticky header detection: Add 'is-stuck' class when headers are stuck at top
    useEffect(() => {
        if (searchQuery.trim()) {
            return;
        }

        const container = listRef.current;
        if (!container) return;

        const updateStickyHeaders = () => {
            const containerRect = container.getBoundingClientRect();

            // Update category headers
            const categoryHeaders = container.querySelectorAll(".settings-category-header");
            categoryHeaders.forEach((header) => {
                const headerRect = header.getBoundingClientRect();
                const section = header.closest(".settings-category-section");
                if (!section) return;

                const sectionRect = section.getBoundingClientRect();

                // Header is stuck if:
                // 1. The section top is above or at the container top
                // 2. The section bottom is still below the header height
                const isStuck =
                    sectionRect.top <= containerRect.top + 1 &&
                    sectionRect.bottom > containerRect.top + headerRect.height;

                if (isStuck) {
                    header.classList.add("is-stuck");
                } else {
                    header.classList.remove("is-stuck");
                }
            });

            // Update subcategory headers
            const subcategoryHeaders = container.querySelectorAll(".settings-subcategory-header");
            subcategoryHeaders.forEach((header) => {
                const headerRect = header.getBoundingClientRect();
                const section = header.closest(".settings-subcategory-section");
                if (!section) return;

                const sectionRect = section.getBoundingClientRect();
                const categorySection = header.closest(".settings-category-section");
                if (!categorySection) return;

                const categorySectionRect = categorySection.getBoundingClientRect();

                // Subcategory header is stuck if:
                // 1. Its section top is at or above the sticky position (container top + category header height ~38px)
                // 2. Its section bottom is still visible
                // 3. The parent category section is still visible
                const stickyTop = containerRect.top + 38;
                const isStuck =
                    sectionRect.top <= stickyTop + 1 &&
                    sectionRect.bottom > stickyTop + headerRect.height &&
                    categorySectionRect.bottom > stickyTop;

                if (isStuck) {
                    header.classList.add("is-stuck");
                } else {
                    header.classList.remove("is-stuck");
                }
            });
        };

        // Initial check
        updateStickyHeaders();

        // Update on scroll
        container.addEventListener("scroll", updateStickyHeaders, { passive: true });

        return () => {
            container.removeEventListener("scroll", updateStickyHeaders);
        };
    }, [searchQuery]);

    // Dynamic bottom padding: Calculate so last section header can stick to top
    useEffect(() => {
        if (searchQuery.trim()) {
            return;
        }

        const container = listRef.current;
        if (!container) return;

        const updateBottomPadding = () => {
            const sections = container.querySelectorAll(".settings-category-section");
            if (sections.length === 0) return;

            const lastSection = sections[sections.length - 1] as HTMLElement;
            const containerHeight = container.clientHeight;
            const lastSectionHeight = lastSection.offsetHeight;

            // Padding needed = container height - last section height
            // This allows scrolling until the last section header sticks at the top
            const paddingNeeded = Math.max(0, containerHeight - lastSectionHeight);
            container.style.paddingBottom = `${paddingNeeded}px`;
        };

        // Initial calculation
        updateBottomPadding();

        // Recalculate on resize
        const resizeObserver = new ResizeObserver(updateBottomPadding);
        resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
            if (container) {
                container.style.paddingBottom = "";
            }
        };
    }, [searchQuery]);

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
            <div ref={listRef} className="settings-list">
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
        <div ref={listRef} className="settings-list">
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
                            <div
                                key={subcategory ?? "default"}
                                id={subcategory ? `settings-subcategory-${category}-${subcategory}` : undefined}
                                className="settings-subcategory-section"
                            >
                                {subcategory && (
                                    <div className="settings-subcategory-header">
                                        {subcategory}
                                    </div>
                                )}
                                <div className="settings-subcategory-content">
                                    {subSettings.map((setting) => (
                                        <SettingRow key={setting.key} metadata={setting} />
                                    ))}
                                </div>
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
