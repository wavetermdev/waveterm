import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import React, { useCallback, useEffect, useRef, useState } from "react";

// Simple file item interface
interface FileItem {
    id: string;
    name: string;
    path: string;
    isDirectory?: boolean;
}

interface FilePickerProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (filePath: string) => void;
    currentDir: string;
}

export const FilePicker: React.FC<FilePickerProps> = ({ isOpen, onClose, onSelect, currentDir }) => {
    const [query, setQuery] = useState("");
    const [files, setFiles] = useState<FileItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [currentDirectory, setCurrentDirectory] = useState(currentDir || ".");
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const widgetId = useRef(`filepicker-${Math.random().toString(36).substring(2, 11)}`);

    // Custom debounce hook
    function useDebounce<T extends (...args: any[]) => any>(callback: T, delay: number) {
        const timeoutRef = useRef<NodeJS.Timeout | null>(null);

        return useCallback(
            (...args: Parameters<T>) => {
                if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current);
                }

                timeoutRef.current = setTimeout(() => {
                    callback(...args);
                }, delay);
            },
            [callback, delay]
        );
    }

    // Real file search function using FileReadCommand
    const searchFiles = async (searchQuery: string) => {
        try {
            setLoading(true);

            // Use FileReadCommand to get directory contents
            const file = await RpcApi.FileReadCommand(
                TabRpcClient,
                {
                    info: {
                        path: currentDirectory,
                    },
                },
                null
            );

            if (file && file.entries) {
                // Convert entries to FileItem format
                const fileItems: FileItem[] = file.entries.map((entry) => ({
                    id: entry.path,
                    name: entry.name,
                    path: entry.path,
                    isDirectory: entry.isdir,
                }));

                // Add parent directory if available
                if (file.info && file.info.dir && file.info.path !== file.info.dir) {
                    fileItems.unshift({
                        id: file.info.dir,
                        name: "..",
                        path: file.info.dir,
                        isDirectory: true,
                    });
                }

                // Improved filtering logic
                let filteredFiles = fileItems;
                if (searchQuery) {
                    const normalizedQuery = searchQuery.toLowerCase().trim();
                    filteredFiles = fileItems.filter((file) => {
                        const normalizedName = file.name.toLowerCase();
                        return (
                            normalizedName.includes(normalizedQuery) ||
                            // Also match without extension
                            normalizedName.split(".")[0].includes(normalizedQuery) ||
                            // Also match just the extension
                            (normalizedName.includes(".") && normalizedName.split(".").pop()?.includes(normalizedQuery))
                        );
                    });
                }

                setFiles(filteredFiles);
                setSelectedIndex(0);
            } else {
                setFiles([]);
            }
        } catch (error) {
            console.error("Failed to search files:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchSuggestions = useDebounce(searchFiles, 300);

    // Clean up when component unmounts
    useEffect(() => {
        return () => {
            // Cleanup code if needed
        };
    }, []);

    // Focus input and initialize when opened
    useEffect(() => {
        if (isOpen) {
            // Reset the query when opening
            setQuery("");

            // Make sure we have a valid directory
            if (!currentDirectory || currentDirectory === "") {
                setCurrentDirectory(".");
            }

            // Initial search
            searchFiles("");

            // Focus the input after a short delay to ensure the component is fully rendered
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                }
            }, 50);
        }
    }, [isOpen]);

    // Update search when current directory changes
    useEffect(() => {
        if (isOpen && currentDirectory) {
            searchFiles(query);
        }
    }, [currentDirectory, isOpen]);

    // Handle query changes
    const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newQuery = e.target.value;
        setQuery(newQuery);
        // Use direct searchFiles instead of debounced version to improve responsiveness
        searchFiles(newQuery);
    };

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case "Escape":
                e.preventDefault();
                onClose();
                break;
            case "ArrowDown":
                e.preventDefault();
                setSelectedIndex((prev) => (prev < files.length - 1 ? prev + 1 : prev));
                break;
            case "ArrowUp":
                e.preventDefault();
                setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
                break;
            case "Enter":
                e.preventDefault();
                if (files[selectedIndex]) {
                    handleFileSelect(files[selectedIndex].path, files[selectedIndex].isDirectory);
                }
                break;
        }
    };

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current && files.length > 0) {
            const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
            if (selectedElement) {
                selectedElement.scrollIntoView({ block: "nearest" });
            }
        }
    }, [selectedIndex, files.length]);

    // Handle file selection
    const handleFileSelect = useCallback(
        (filePath: string, isDirectory?: boolean) => {
            if (isDirectory) {
                // If it's a directory, update the current directory and refresh the file list
                setCurrentDirectory(filePath);
                setSelectedIndex(0);
            } else {
                // If it's a file, call onSelect and close the picker
                onSelect(filePath);
                onClose();
            }
        },
        [onSelect, onClose]
    );

    if (!isOpen) return null;

    return (
        <div className="file-picker-overlay" onClick={onClose}>
            <div className="file-picker-modal" onClick={(e) => e.stopPropagation()}>
                <div className="file-picker-header">
                    <h3>Select a file to attach</h3>
                    <button className="close-button" onClick={onClose}>
                        ×
                    </button>
                </div>
                <div className="file-picker-search">
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={handleQueryChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Search files..."
                        autoFocus
                    />
                </div>
                <div className="file-picker-list" ref={listRef}>
                    {loading ? (
                        <div className="loading">Loading...</div>
                    ) : files.length > 0 ? (
                        files.map((file, index) => (
                            <div
                                key={file.id}
                                className={`file-item ${index === selectedIndex ? "selected" : ""}`}
                                onClick={() => handleFileSelect(file.path, file.isDirectory)}
                                onMouseEnter={() => setSelectedIndex(index)}
                            >
                                <div className="file-icon">{file.isDirectory ? "📁" : "📄"}</div>
                                <div className="file-name">{file.name}</div>
                            </div>
                        ))
                    ) : (
                        <div className="no-results">No files found</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FilePicker;
