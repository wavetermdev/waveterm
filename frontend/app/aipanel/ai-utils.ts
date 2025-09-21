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