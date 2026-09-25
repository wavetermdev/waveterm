// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AlertModal } from "@/app/modals/alertmodal";
import { useState } from "react";

type PreviewEntry = {
    label: string;
    message: string;
    title?: string;
    icon?: string;
    iconClassName?: string;
};

const previews: PreviewEntry[] = [
    {
        label: "Default",
        message: "A much longer message that might wrap across multiple lines in the modal body to test layout behavior with extended content.",
    },
    {
        label: "Short message",
        message: "Short error.",
    },
    {
        label: "Error",
        title: "Save Failed",
        message: "Error saving file: EACCES: permission denied, open '/root/notes.md'",
        icon: "circle-exclamation",
        iconClassName: "text-error",
    },
    {
        label: "Error + custom icon",
        title: "Connection Failed",
        message: "Unable to connect to remote host. Check your SSH configuration and try again.",
        icon: "plug-circle-xmark",
        iconClassName: "text-error",
    },
    {
        label: "Warning",
        title: "Unsaved Changes",
        message: "You have unsaved changes. They will be lost if you continue.",
        icon: "triangle-exclamation",
        iconClassName: "text-warning",
    },
];

export function AlertModalPreview() {
    const [key, setKey] = useState(0);
    const [current, setCurrent] = useState<PreviewEntry | null>(null);

    return (
        <div className="flex flex-col items-center gap-4 pt-8">
            <p className="text-muted text-sm">Click a button to open the AlertModal.</p>
            <div className="flex gap-2 flex-wrap justify-center">
                {previews.map((p, i) => (
                    <button
                        key={i}
                        className="bg-accent/80 text-primary rounded px-3 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer"
                        onClick={() => {
                            setCurrent(p);
                            setKey((k) => k + 1);
                        }}
                    >
                        {p.label}
                    </button>
                ))}
            </div>
            {current && (
                <AlertModal
                    key={key}
                    title={current.title}
                    icon={current.icon}
                    iconClassName={current.iconClassName}
                    onClose={() => setCurrent(null)}
                >
                    {current.message}
                </AlertModal>
            )}
        </div>
    );
}
