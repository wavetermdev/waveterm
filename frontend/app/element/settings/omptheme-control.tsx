// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Oh-My-Posh Theme Control
 *
 * Visual theme selector for Oh-My-Posh themes, similar to the terminal theme control.
 * Displays a grid of theme cards with color preview swatches.
 */

import { ompThemesProvider } from "@/app/store/settings-options-provider";
import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import "./omptheme-control.scss";

interface OmpTheme {
    name: string;
    displayName: string;
    colors: string[];
}

interface OmpThemeControlProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

/**
 * Individual theme card component
 */
interface ThemeCardProps {
    theme: OmpTheme;
    selected: boolean;
    onClick: () => void;
}

const ThemeCard = memo(({ theme, selected, onClick }: ThemeCardProps) => {
    return (
        <div
            className={cn("omptheme-card", { selected })}
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            aria-pressed={selected}
            aria-label={`${theme.displayName} theme${selected ? " (selected)" : ""}`}
        >
            <div className="omptheme-preview" style={{ background: theme.colors[0] }}>
                <div className="omptheme-color-row">
                    {theme.colors.slice(0, 8).map((color, i) => (
                        <div
                            key={i}
                            className="omptheme-swatch"
                            style={{ backgroundColor: color }}
                            title={color}
                        />
                    ))}
                </div>
            </div>
            <div className="omptheme-name">{theme.displayName}</div>
            {selected && (
                <div className="omptheme-check">
                    <i className="fa fa-solid fa-check" />
                </div>
            )}
        </div>
    );
});

ThemeCard.displayName = "ThemeCard";

/**
 * Main OMP theme selector component
 */
export const OmpThemeControl = memo(({ value, onChange, disabled }: OmpThemeControlProps) => {
    const [themes, setThemes] = useState<OmpTheme[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        const fetchThemes = async () => {
            try {
                const themeList = await ompThemesProvider.getThemes();
                setThemes(themeList);
                setError(null);
            } catch (err) {
                console.error("Failed to load OMP themes:", err);
                setError("Failed to load themes");
            } finally {
                setLoading(false);
            }
        };
        fetchThemes();
    }, []);

    const handleThemeClick = useCallback(
        (themeName: string) => {
            if (!disabled) {
                onChange(themeName);
            }
        },
        [onChange, disabled]
    );

    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
    }, []);

    const handleClearSearch = useCallback(() => {
        setSearchQuery("");
    }, []);

    // Filter themes based on search query
    const filteredThemes = useMemo(() => {
        if (!searchQuery.trim()) {
            return themes;
        }
        const query = searchQuery.toLowerCase();
        return themes.filter(
            (theme) =>
                theme.name.toLowerCase().includes(query) ||
                theme.displayName.toLowerCase().includes(query)
        );
    }, [themes, searchQuery]);

    if (loading) {
        return (
            <div className="omptheme-control">
                <div className="omptheme-loading">
                    <i className="fa fa-solid fa-spinner fa-spin" />
                    <span>Loading themes...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="omptheme-control">
                <div className="omptheme-error">
                    <i className="fa fa-solid fa-exclamation-triangle" />
                    <span>{error}</span>
                </div>
            </div>
        );
    }

    return (
        <div className={cn("omptheme-control", { disabled })}>
            {/* Search bar */}
            <div className="omptheme-search">
                <i className="fa fa-solid fa-search search-icon" />
                <input
                    type="text"
                    placeholder="Search themes..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    disabled={disabled}
                />
                {searchQuery && (
                    <button
                        className="clear-button"
                        onClick={handleClearSearch}
                        type="button"
                        aria-label="Clear search"
                    >
                        <i className="fa fa-solid fa-times" />
                    </button>
                )}
            </div>

            {/* Theme count */}
            <div className="omptheme-count">
                {filteredThemes.length} theme{filteredThemes.length !== 1 ? "s" : ""}
                {searchQuery && ` matching "${searchQuery}"`}
            </div>

            {/* Theme grid */}
            {filteredThemes.length === 0 ? (
                <div className="omptheme-empty">
                    <i className="fa fa-solid fa-search" />
                    <span>No themes found for "{searchQuery}"</span>
                </div>
            ) : (
                <div className="omptheme-grid">
                    {filteredThemes.map((theme) => (
                        <ThemeCard
                            key={theme.name}
                            theme={theme}
                            selected={value === theme.name}
                            onClick={() => handleThemeClick(theme.name)}
                        />
                    ))}
                </div>
            )}

            {/* Instructions */}
            <div className="omptheme-instructions">
                <i className="fa fa-solid fa-info-circle" />
                <span>
                    Selected theme: <strong>{value || "None"}</strong>.
                    After selecting a theme, you'll need to configure Oh-My-Posh to use it.
                    See the <a href="https://ohmyposh.dev/docs/installation/customize" target="_blank" rel="noopener noreferrer">OMP documentation</a> for setup instructions.
                </span>
            </div>
        </div>
    );
});

OmpThemeControl.displayName = "OmpThemeControl";

export type { OmpThemeControlProps };
