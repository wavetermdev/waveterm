// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect } from "react";

interface ModalProps {
    config: ModalConfig;
    onClose: (confirmed: boolean) => void;
}

export const AlertModal: React.FC<ModalProps> = ({ config, onClose }) => {
    const handleOk = () => {
        onClose(true);
    };

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose(false);
            }
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 border border-gray-700">
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        {config.icon && <div className="text-4xl">{config.icon}</div>}
                        <h2 className="text-xl font-semibold text-white">{config.title}</h2>
                    </div>
                    {config.text && <p className="text-gray-300">{config.text}</p>}
                    <div className="flex justify-end gap-3 mt-2">
                        <button
                            onClick={handleOk}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {config.oktext || "OK"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const ConfirmModal: React.FC<ModalProps> = ({ config, onClose }) => {
    const handleConfirm = () => {
        onClose(true);
    };

    const handleCancel = () => {
        onClose(false);
    };

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose(false);
            }
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 border border-gray-700">
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        {config.icon && <div className="text-4xl">{config.icon}</div>}
                        <h2 className="text-xl font-semibold text-white">{config.title}</h2>
                    </div>
                    {config.text && <p className="text-gray-300">{config.text}</p>}
                    <div className="flex justify-end gap-3 mt-2">
                        <button
                            onClick={handleCancel}
                            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
                        >
                            {config.canceltext || "Cancel"}
                        </button>
                        <button
                            onClick={handleConfirm}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {config.oktext || "OK"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
