// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const isAcceptableFile = (file: File): boolean => {
    const acceptableTypes = [
        // Images
        'image/jpeg',
        'image/jpg', 
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        // PDFs
        'application/pdf',
        // Text files
        'text/plain',
        'text/markdown',
        'text/html',
        'text/css',
        'text/javascript',
        'text/typescript',
        // Application types for code files
        'application/javascript',
        'application/typescript',
        'application/json',
        'application/xml',
    ];

    if (acceptableTypes.includes(file.type)) {
        return true;
    }

    // Check file extensions for files without proper MIME types
    const extension = file.name.split('.').pop()?.toLowerCase();
    const acceptableExtensions = [
        'txt', 'md', 'js', 'jsx', 'ts', 'tsx', 'go', 'py', 'java', 'c', 'cpp', 'h', 'hpp',
        'html', 'css', 'scss', 'sass', 'json', 'xml', 'yaml', 'yml', 'sh', 'bat', 'sql',
        'php', 'rb', 'rs', 'swift', 'kt', 'cs', 'vb', 'r', 'scala', 'clj', 'ex', 'exs'
    ];

    return extension ? acceptableExtensions.includes(extension) : false;
};

export const getFileIcon = (fileName: string, fileType: string): string => {
    if (fileType.startsWith('image/')) {
        return 'fa-image';
    }
    
    if (fileType === 'application/pdf') {
        return 'fa-file-pdf';
    }
    
    // Check file extensions for code files
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'js':
        case 'jsx':
        case 'ts':
        case 'tsx':
            return 'fa-file-code';
        case 'go':
            return 'fa-file-code';
        case 'py':
            return 'fa-file-code';
        case 'java':
        case 'c':
        case 'cpp':
        case 'h':
        case 'hpp':
            return 'fa-file-code';
        case 'html':
        case 'css':
        case 'scss':
        case 'sass':
            return 'fa-file-code';
        case 'json':
        case 'xml':
        case 'yaml':
        case 'yml':
            return 'fa-file-code';
        case 'md':
        case 'txt':
            return 'fa-file-text';
        default:
            return 'fa-file';
    }
};

export const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Normalize MIME type for AI processing
export const normalizeMimeType = (file: File): string => {
    const fileType = file.type;
    
    // Images keep their real mimetype
    if (fileType.startsWith('image/')) {
        return fileType;
    }
    
    // PDFs keep their mimetype
    if (fileType === 'application/pdf') {
        return fileType;
    }
    
    // Everything else (code files, markdown, text, etc.) becomes text/plain
    return 'text/plain';
};

// Helper function to read file as base64 for AIMessage
export const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix to get just base64
            const base64 = result.split(',')[1];
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
    fileType: 'text' | 'pdf' | 'image';
}

export const validateFileSize = (file: File): FileSizeError | null => {
    const TEXT_FILE_LIMIT = 200 * 1024; // 200KB
    const PDF_LIMIT = 5 * 1024 * 1024; // 5MB
    const IMAGE_LIMIT = 10 * 1024 * 1024; // 10MB

    if (file.type.startsWith('image/')) {
        if (file.size > IMAGE_LIMIT) {
            return {
                fileName: file.name,
                fileSize: file.size,
                maxSize: IMAGE_LIMIT,
                fileType: 'image'
            };
        }
    } else if (file.type === 'application/pdf') {
        if (file.size > PDF_LIMIT) {
            return {
                fileName: file.name,
                fileSize: file.size,
                maxSize: PDF_LIMIT,
                fileType: 'pdf'
            };
        }
    } else {
        if (file.size > TEXT_FILE_LIMIT) {
            return {
                fileName: file.name,
                fileSize: file.size,
                maxSize: TEXT_FILE_LIMIT,
                fileType: 'text'
            };
        }
    }

    return null;
};

export const formatFileSizeError = (error: FileSizeError): string => {
    const typeLabel = error.fileType === 'image' ? 'Image' : error.fileType === 'pdf' ? 'PDF' : 'Text file';
    return `${typeLabel} "${error.fileName}" is too large (${formatFileSize(error.fileSize)}). Maximum size is ${formatFileSize(error.maxSize)}.`;
};

/**
 * Resize an image to have a maximum edge of 4096px and convert to WebP format
 * Returns the optimized image if it's smaller than the original, otherwise returns the original
 */
export const resizeImage = async (file: File): Promise<File> => {
    // Only process actual image files (not SVG)
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
        return file;
    }

    const MAX_EDGE = 4096;
    const WEBP_QUALITY = 0.8;

    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = async () => {
            URL.revokeObjectURL(url);

            let { width, height } = img;
            
            // Check if resizing is needed
            if (width <= MAX_EDGE && height <= MAX_EDGE) {
                // Image is already small enough, just try WebP conversion
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0);

                canvas.toBlob(
                    (blob) => {
                        if (blob && blob.size < file.size) {
                            const webpFile = new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), {
                                type: 'image/webp',
                            });
                            console.log(`Image resized (no dimension change): ${file.name} - Original: ${formatFileSize(file.size)}, WebP: ${formatFileSize(blob.size)}`);
                            resolve(webpFile);
                        } else {
                            console.log(`Image kept original (WebP not smaller): ${file.name} - ${formatFileSize(file.size)}`);
                            resolve(file);
                        }
                    },
                    'image/webp',
                    WEBP_QUALITY
                );
                return;
            }

            // Calculate new dimensions while maintaining aspect ratio
            if (width > height) {
                height = Math.round((height * MAX_EDGE) / width);
                width = MAX_EDGE;
            } else {
                width = Math.round((width * MAX_EDGE) / height);
                height = MAX_EDGE;
            }

            // Create canvas and resize
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);

            // Convert to WebP
            canvas.toBlob(
                (blob) => {
                    if (blob && blob.size < file.size) {
                        const webpFile = new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), {
                            type: 'image/webp',
                        });
                        console.log(`Image resized: ${file.name} (${img.width}x${img.height} → ${width}x${height}) - Original: ${formatFileSize(file.size)}, WebP: ${formatFileSize(blob.size)}`);
                        resolve(webpFile);
                    } else {
                        console.log(`Image kept original (WebP not smaller): ${file.name} (${img.width}x${img.height} → ${width}x${height}) - ${formatFileSize(file.size)}`);
                        resolve(file);
                    }
                },
                'image/webp',
                WEBP_QUALITY
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
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
        return null;
    }

    const PREVIEW_SIZE = 128;
    const WEBP_QUALITY = 0.8;

    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            let { width, height } = img;

            if (width > height) {
                height = Math.round((height * PREVIEW_SIZE) / width);
                width = PREVIEW_SIZE;
            } else {
                width = Math.round((width * PREVIEW_SIZE) / height);
                height = PREVIEW_SIZE;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
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
                'image/webp',
                WEBP_QUALITY
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };

        img.src = url;
    });
};