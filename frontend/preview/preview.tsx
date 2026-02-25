// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { setWaveWindowType } from "@/app/store/windowtype";
import { loadFonts } from "@/util/fontutil";
import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";

import "../app/app.scss";

// preview.css should come *after* app.scss (don't remove the newline above otherwise prettier will reorder these imports)
// preview.css re-exports tailwindsetup.css and adds @source "../app" so Tailwind v4 scans frontend/app/** for class names
import "./preview.css";

// Vite glob import — statically analyzed at build time, lazily loaded at runtime.
// Each *.preview.tsx file is auto-discovered; its filename (minus the suffix) becomes the key.
// Files may use a default export or any named export — the first export found is used as the component.
const previewModules = import.meta.glob<{ default?: React.ComponentType; [key: string]: unknown }>(
    "./previews/*.preview.tsx"
);

// Derive a human-readable key from the file path, e.g.:
//   "./previews/modal-about.preview.tsx"  →  "modal-about"
function pathToKey(path: string): string {
    return path.replace(/^\.\/previews\//, "").replace(/\.preview\.tsx$/, "");
}

// Build a map of key → lazy React component.
// Each preview file is expected to have a default export that is the preview component.
const previews: Record<string, React.LazyExoticComponent<React.ComponentType>> = Object.fromEntries(
    Object.entries(previewModules).map(([path, loader]) => [
        pathToKey(path),
        lazy(() =>
            loader().then((mod) => ({ default: (mod.default ?? Object.values(mod)[0]) as React.ComponentType }))
        ),
    ])
);

function PreviewIndex() {
    return (
        <div className="min-h-screen bg-background text-foreground font-sans flex flex-col items-center justify-center gap-6">
            <div className="flex flex-col items-center gap-3">
                <Logo />
                <h1 className="text-title font-semibold tracking-tight text-foreground">Wave Preview Server</h1>
            </div>

            <div className="w-px h-8 bg-border" />

            <div className="flex flex-col items-center gap-3 max-w-[1200px] w-full px-4">
                <p className="text-muted text-xs mb-1">Available previews:</p>
                <div className="flex flex-wrap gap-2.5 justify-center">
                    {Object.keys(previews).map((name) => (
                        <a
                            key={name}
                            href={`?preview=${name}`}
                            className="w-[220px] font-mono bg-accentbg px-3 py-1.5 rounded text-sm hover:bg-accent/80 transition-colors overflow-hidden text-ellipsis whitespace-nowrap block text-foreground!"
                        >
                            {name}
                        </a>
                    ))}
                </div>
            </div>
        </div>
    );
}

function PreviewHeader({ previewName }: { previewName: string }) {
    return (
        <div
            className="fixed top-0 left-0 right-0 flex items-center gap-3 px-4 py-2 bg-panel border-b border-border"
            style={{ zIndex: 100000 }}
        >
            <a
                href="/"
                className="flex items-center gap-1.5 text-accent text-sm hover:opacity-80 transition-opacity font-mono"
            >
                ← index
            </a>
            <div className="w-px h-4 bg-border" />
            <span className="text-muted text-xs font-mono">{previewName}</span>
        </div>
    );
}

function PreviewApp() {
    const params = new URLSearchParams(window.location.search);
    const previewName = params.get("preview");

    if (previewName) {
        const PreviewComponent = previews[previewName];
        if (PreviewComponent) {
            return (
                <>
                    <PreviewHeader previewName={previewName} />
                    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col items-center justify-center">
                        <Suspense fallback={null}>
                            <PreviewComponent />
                        </Suspense>
                    </div>
                </>
            );
        }
        return (
            <>
                <PreviewHeader previewName={previewName} />
                <div className="min-h-screen bg-background text-foreground font-sans flex flex-col items-center justify-center gap-4">
                    <p className="text-error">Preview not found: {previewName}</p>
                    <a href="/" className="text-accent text-sm hover:opacity-80">
                        ← Back to index
                    </a>
                </div>
            </>
        );
    }

    return <PreviewIndex />;
}

function initPreview() {
    setWaveWindowType("preview");
    loadFonts();
    const root = createRoot(document.getElementById("main")!);
    root.render(<PreviewApp />);
}

initPreview();
