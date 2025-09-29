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