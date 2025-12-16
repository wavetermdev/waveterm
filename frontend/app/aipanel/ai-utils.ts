// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { sortByDisplayOrder } from "@/util/util";

const TextFileLimit = 200 * 1024; // 200KB
const PdfLimit = 5 * 1024 * 1024; // 5MB
const ImageLimit = 10 * 1024 * 1024; // 10MB
const ImagePreviewSize = 128;
const ImagePreviewWebPQuality = 0.8;
const ImageMaxEdge = 4096;

export const isAcceptableFile = (file: File): boolean => {
    const acceptableTypes = [
        // Images
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/svg+xml",
        // PDFs
        "application/pdf",
        // Text files
        "text/plain",
        "text/markdown",
        "text/html",
        "text/css",
        "text/javascript",
        "text/typescript",
        // Application types for code files
        "application/javascript",
        "application/typescript",
        "application/json",
        "application/xml",
    ];

    if (acceptableTypes.includes(file.type)) {
        return true;
    }

    // Check file extensions for files without proper MIME types
    const extension = file.name.split(".").pop()?.toLowerCase();
    const acceptableExtensions = [
        "txt",
        "log",
        "md",
        "js",
        "mjs",
        "cjs",
        "jsx",
        "ts",
        "mts",
        "cts",
        "tsx",
        "go",
        "py",
        "java",
        "c",
        "cpp",
        "h",
        "hpp",
        "html",
        "htm",
        "css",
        "scss",
        "sass",
        "json",
        "jsonc",
        "json5",
        "jsonl",
        "ndjson",
        "xml",
        "yaml",
        "yml",
        "sh",
        "bat",
        "sql",
        "php",
        "rb",
        "rs",
        "swift",
        "kt",
        "cs",
        "vb",
        "r",
        "scala",
        "clj",
        "ex",
        "exs",
        "ini",
        "toml",
        "conf",
        "cfg",
        "env",
        "zsh",
        "fish",
        "ps1",
        "psm1",
        "bazel",
        "bzl",
        "csv",
        "tsv",
        "properties",
        "ipynb",
        "rmd",
        "gradle",
        "groovy",
        "cmake",
    ];

    if (extension && acceptableExtensions.includes(extension)) {
        return true;
    }

    // Check for specific filenames (case-insensitive)
    const fileName = file.name.toLowerCase();
    const acceptableFilenames = [
        "makefile",
        "dockerfile",
        "containerfile",
        "go.mod",
        "go.sum",
        "go.work",
        "go.work.sum",
        "package.json",
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "composer.json",
        "composer.lock",
        "gemfile",
        "gemfile.lock",
        "podfile",
        "podfile.lock",
        "cargo.toml",
        "cargo.lock",
        "pipfile",
        "pipfile.lock",
        "requirements.txt",
        "setup.py",
        "pyproject.toml",
        "poetry.lock",
        "build.gradle",
        "settings.gradle",
        "pom.xml",
        "build.xml",
        "readme",
        "readme.md",
        "license",
        "license.md",
        "changelog",
        "changelog.md",
        "contributing",
        "contributing.md",
        "authors",
        "codeowners",
        "procfile",
        "jenkinsfile",
        "vagrantfile",
        "rakefile",
        "gruntfile.js",
        "gulpfile.js",
        "webpack.config.js",
        "rollup.config.js",
        "vite.config.js",
        "jest.config.js",
        "vitest.config.js",
        ".dockerignore",
        ".gitignore",
        ".gitattributes",
        ".gitmodules",
        ".editorconfig",
        ".eslintrc",
        ".prettierrc",
        ".pylintrc",
        ".bashrc",
        ".bash_profile",
        ".bash_login",
        ".bash_logout",
        ".profile",
        ".zshrc",
        ".zprofile",
        ".zshenv",
        ".zlogin",
        ".zlogout",
        ".kshrc",
        ".cshrc",
        ".tcshrc",
        ".xonshrc",
        ".shrc",
        ".aliases",
        ".functions",
        ".exports",
        ".direnvrc",
        ".vimrc",
        ".gvimrc",
    ];

    return acceptableFilenames.includes(fileName);
};

export const getFileIcon = (fileName: string, fileType: string): string => {
    if (fileType === "directory") {
        return "fa-folder";
    }

    if (fileType.startsWith("image/")) {
        return "fa-image";
    }

    if (fileType === "application/pdf") {
        return "fa-file-pdf";
    }

    // Check file extensions for code files
    const ext = fileName.split(".").pop()?.toLowerCase();
    switch (ext) {
        case "js":
        case "jsx":
        case "ts":
        case "tsx":
            return "fa-file-code";
        case "go":
            return "fa-file-code";
        case "py":
            return "fa-file-code";
        case "java":
        case "c":
        case "cpp":
        case "h":
        case "hpp":
            return "fa-file-code";
        case "html":
        case "css":
        case "scss":
        case "sass":
            return "fa-file-code";
        case "json":
        case "xml":
        case "yaml":
        case "yml":
            return "fa-file-code";
        case "md":
        case "txt":
            return "fa-file-text";
        default:
            return "fa-file";
    }
};

export const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

// Normalize MIME type for AI processing
export const normalizeMimeType = (file: File): string => {
    const fileType = file.type;

    // Images keep their real mimetype
    if (fileType.startsWith("image/")) {
        return fileType;
    }

    // PDFs keep their mimetype
    if (fileType === "application/pdf") {
        return fileType;
    }

    // Everything else (code files, markdown, text, etc.) becomes text/plain
    return "text/plain";
};

// Helper function to read file as base64 for AIMessage
export const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix to get just base64
            const base64 = result.split(",")[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

// Helper function to create data URL for UIMessage
export const createDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

export interface FileSizeError {
    fileName: string;
    fileSize: number;
    maxSize: number;
    fileType: "text" | "pdf" | "image";
}

export const validateFileSize = (file: File): FileSizeError | null => {
    if (file.type.startsWith("image/")) {
        if (file.size > ImageLimit) {
            return {
                fileName: file.name,
                fileSize: file.size,
                maxSize: ImageLimit,
                fileType: "image",
            };
        }
    } else if (file.type === "application/pdf") {
        if (file.size > PdfLimit) {
            return {
                fileName: file.name,
                fileSize: file.size,
                maxSize: PdfLimit,
                fileType: "pdf",
            };
        }
    } else {
        if (file.size > TextFileLimit) {
            return {
                fileName: file.name,
                fileSize: file.size,
                maxSize: TextFileLimit,
                fileType: "text",
            };
        }
    }

    return null;
};

export const validateFileSizeFromInfo = (
    fileName: string,
    fileSize: number,
    mimeType: string
): FileSizeError | null => {
    let maxSize: number;
    let fileType: "text" | "pdf" | "image";

    if (mimeType.startsWith("image/")) {
        maxSize = ImageLimit;
        fileType = "image";
    } else if (mimeType === "application/pdf") {
        maxSize = PdfLimit;
        fileType = "pdf";
    } else {
        maxSize = TextFileLimit;
        fileType = "text";
    }

    if (fileSize > maxSize) {
        return {
            fileName,
            fileSize,
            maxSize,
            fileType,
        };
    }

    return null;
};

export const formatFileSizeError = (error: FileSizeError): string => {
    const typeLabel = error.fileType === "image" ? "Image" : error.fileType === "pdf" ? "PDF" : "Text file";
    return `${typeLabel} "${error.fileName}" is too large (${formatFileSize(error.fileSize)}). Maximum size is ${formatFileSize(error.maxSize)}.`;
};

/**
 * Resize an image to have a maximum edge of 4096px and convert to WebP format
 * Returns the optimized image if it's smaller than the original, otherwise returns the original
 */
export const resizeImage = async (file: File): Promise<File> => {
    // Only process actual image files (not SVG)
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
        return file;
    }

    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = async () => {
            URL.revokeObjectURL(url);

            let { width, height } = img;

            // Check if resizing is needed
            if (width <= ImageMaxEdge && height <= ImageMaxEdge) {
                // Image is already small enough, just try WebP conversion
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx?.drawImage(img, 0, 0);

                canvas.toBlob(
                    (blob) => {
                        if (blob && blob.size < file.size) {
                            const webpFile = new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), {
                                type: "image/webp",
                            });
                            console.log(
                                `Image resized (no dimension change): ${file.name} - Original: ${formatFileSize(file.size)}, WebP: ${formatFileSize(blob.size)}`
                            );
                            resolve(webpFile);
                        } else {
                            console.log(
                                `Image kept original (WebP not smaller): ${file.name} - ${formatFileSize(file.size)}`
                            );
                            resolve(file);
                        }
                    },
                    "image/webp",
                    ImagePreviewWebPQuality
                );
                return;
            }

            // Calculate new dimensions while maintaining aspect ratio
            if (width > height) {
                height = Math.round((height * ImageMaxEdge) / width);
                width = ImageMaxEdge;
            } else {
                width = Math.round((width * ImageMaxEdge) / height);
                height = ImageMaxEdge;
            }

            // Create canvas and resize
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx?.drawImage(img, 0, 0, width, height);

            // Convert to WebP
            canvas.toBlob(
                (blob) => {
                    if (blob && blob.size < file.size) {
                        const webpFile = new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), {
                            type: "image/webp",
                        });
                        console.log(
                            `Image resized: ${file.name} (${img.width}x${img.height} → ${width}x${height}) - Original: ${formatFileSize(file.size)}, WebP: ${formatFileSize(blob.size)}`
                        );
                        resolve(webpFile);
                    } else {
                        console.log(
                            `Image kept original (WebP not smaller): ${file.name} (${img.width}x${img.height} → ${width}x${height}) - ${formatFileSize(file.size)}`
                        );
                        resolve(file);
                    }
                },
                "image/webp",
                ImagePreviewWebPQuality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(file);
        };

        img.src = url;
    });
};

/**
 * Create a 128x128 preview data URL for an image file
 */
export const createImagePreview = async (file: File): Promise<string | null> => {
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
        return null;
    }

    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            let { width, height } = img;

            if (width > height) {
                height = Math.round((height * ImagePreviewSize) / width);
                width = ImagePreviewSize;
            } else {
                width = Math.round((width * ImagePreviewSize) / height);
                height = ImagePreviewSize;
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx?.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            resolve(reader.result as string);
                        };
                        reader.readAsDataURL(blob);
                    } else {
                        resolve(null);
                    }
                },
                "image/webp",
                ImagePreviewWebPQuality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };

        img.src = url;
    });
};


/**
 * Filter and organize AI mode configs into Wave and custom provider groups
 * Returns organized configs that should be displayed based on settings and premium status
 */
export interface FilteredAIModeConfigs {
    waveProviderConfigs: Array<{ mode: string } & AIModeConfigType>;
    otherProviderConfigs: Array<{ mode: string } & AIModeConfigType>;
    shouldShowCloudModes: boolean;
}

export const getFilteredAIModeConfigs = (
    aiModeConfigs: Record<string, AIModeConfigType>,
    showCloudModes: boolean,
    inBuilder: boolean,
    hasPremium: boolean,
    currentMode?: string
): FilteredAIModeConfigs => {
    const hideQuick = inBuilder && hasPremium;

    const allConfigs = Object.entries(aiModeConfigs)
        .map(([mode, config]) => ({ mode, ...config }))
        .filter((config) => !(hideQuick && config.mode === "waveai@quick"));

    const otherProviderConfigs = allConfigs
        .filter((config) => config["ai:provider"] !== "wave")
        .sort(sortByDisplayOrder);

    const hasCustomModels = otherProviderConfigs.length > 0;
    const isCurrentModeCloud = currentMode?.startsWith("waveai@") ?? false;
    const shouldShowCloudModes = showCloudModes || !hasCustomModels || isCurrentModeCloud;

    const waveProviderConfigs = shouldShowCloudModes
        ? allConfigs.filter((config) => config["ai:provider"] === "wave").sort(sortByDisplayOrder)
        : [];

    return {
        waveProviderConfigs,
        otherProviderConfigs,
        shouldShowCloudModes,
    };
};

/**
 * Get the display name for an AI mode configuration.
 * If display:name is set, use that. Otherwise, construct from model/provider.
 * For azure-legacy, show "azureresourcename (azure)".
 * For other providers, show "model (provider)".
 */
export function getModeDisplayName(config: AIModeConfigType): string {
    if (config["display:name"]) {
        return config["display:name"];
    }

    const provider = config["ai:provider"];
    const model = config["ai:model"];
    const azureResourceName = config["ai:azureresourcename"];

    if (provider === "azure-legacy") {
        return `${azureResourceName || "unknown"} (azure)`;
    }

    return `${model || "unknown"} (${provider || "custom"})`;
}
