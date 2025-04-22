import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import React, { useState } from "react";
import { FilePicker } from "./filepicker";

// Define FileAttachment type
interface FileAttachment {
    file_path: string;
    file_content: string;
    file_name: string;
}

interface FileAttachmentButtonProps {
    onAttach: (filePath: string, attachment: FileAttachment) => void;
    currentDir?: string;
}

/**
 * A button that opens a file picker to attach files to messages
 */
export const FileAttachmentButton: React.FC<FileAttachmentButtonProps> = ({ onAttach, currentDir }) => {
    const [showFilePicker, setShowFilePicker] = useState(false);

    const handleFileSelect = async (filePath: string) => {
        try {
            const attachment = await RpcApi.AiAttachFileCommand(TabRpcClient, filePath, {});
            if (attachment) {
                onAttach(filePath, attachment);
                setShowFilePicker(false);
            }
        } catch (error) {
            console.error("Error attaching file:", error);
        }
    };

    return (
        <>
            <button className="file-attachment-button" onClick={() => setShowFilePicker(true)} title="Attach a file">
                <i className="fa-solid fa-paperclip"></i>
            </button>

            {showFilePicker && (
                <FilePicker
                    isOpen={showFilePicker}
                    onClose={() => setShowFilePicker(false)}
                    onSelect={handleFileSelect}
                    currentDir={currentDir}
                />
            )}
        </>
    );
};

interface FileAttachmentListProps {
    attachments: FileAttachment[];
    onRemove: (filePath: string) => void;
}

/**
 * Displays a list of attached files with option to remove them
 */
export const FileAttachmentList: React.FC<FileAttachmentListProps> = ({ attachments, onRemove }) => {
    if (!attachments?.length) return null;

    return (
        <div className="file-attachments">
            {attachments.map((attachment) => (
                <div key={attachment.file_path} className="file-attachment">
                    <span className="file-name">{attachment.file_name}</span>
                    <span className="remove-file" onClick={() => onRemove(attachment.file_path)}>
                        ×
                    </span>
                </div>
            ))}
        </div>
    );
};
