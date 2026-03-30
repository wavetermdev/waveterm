// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { FloatingPortal, VirtualElement, flip, offset, shift, useFloating } from "@floating-ui/react";
import * as React from "react";
import type { TermWrap } from "./termwrap";

// ── low-level primitive ──────────────────────────────────────────────────────

interface TermTooltipProps {
    /** Screen-space mouse position (clientX/clientY). null means hidden. */
    mousePos: { x: number; y: number } | null;
    content: React.ReactNode;
}

/**
 * A floating tooltip anchored to the current mouse position.
 * Uses a floating-ui virtual element (via refs.setPositionReference) so no
 * real DOM reference is required.  Renders into a FloatingPortal.
 */
export const TermTooltip = React.memo(function TermTooltip({ mousePos, content }: TermTooltipProps) {
    const isOpen = mousePos != null;

    // Keep latest mousePos in a ref so the virtual element always reflects it.
    const mousePosRef = React.useRef(mousePos);
    mousePosRef.current = mousePos;

    const { refs, floatingStyles } = useFloating({
        open: isOpen,
        placement: "top-start",
        middleware: [offset({ mainAxis: 12, crossAxis: -20 }), flip(), shift({ padding: 0 })],
    });

    // Update the position reference whenever mousePos changes.
    React.useLayoutEffect(() => {
        if (!isOpen) {
            return;
        }
        const virtualEl: VirtualElement = {
            getBoundingClientRect() {
                const pos = mousePosRef.current ?? { x: 0, y: 0 };
                return new DOMRect(pos.x, pos.y, 0, 0);
            },
        };
        refs.setPositionReference(virtualEl);
    }, [isOpen, mousePos?.x, mousePos?.y]);

    if (!isOpen) {
        return null;
    }

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={floatingStyles}
                className="bg-zinc-800/70 rounded-md px-2 py-1 text-xs text-secondary shadow-xl z-50 pointer-events-none select-none"
            >
                {content}
            </div>
        </FloatingPortal>
    );
});

// ── wired-up sub-component ───────────────────────────────────────────────────

function clearTimeoutRef(ref: React.RefObject<number | null>) {
    if (ref.current == null) {
        return;
    }
    window.clearTimeout(ref.current);
    ref.current = null;
}

const HoverDelayMs = 600;
const MaxHoverTimeMs = 2200;
const modKey = PLATFORM === PlatformMacOS ? "Cmd" : "Ctrl";

interface TermLinkTooltipProps {
    /**
     * The live TermWrap instance. Pass the instance directly (not a ref) so
     * React re-runs the effect when it changes (e.g. on terminal recreate).
     */
    termWrap: TermWrap | null;
}

/**
 * Self-contained sub-component that subscribes to the termWrap link-hover
 * callback and renders a tooltip after a short delay.  Keeping state here
 * prevents unnecessary re-renders of the parent TerminalView.
 */
export const TermLinkTooltip = React.memo(function TermLinkTooltip({ termWrap }: TermLinkTooltipProps) {
    const [mousePos, setMousePos] = React.useState<{ x: number; y: number } | null>(null);
    const timeoutRef = React.useRef<number | null>(null);
    const maxTimeoutRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        if (termWrap == null) {
            return;
        }

        termWrap.onLinkHover = (uri: string | null, mouseX: number, mouseY: number) => {
            clearTimeoutRef(timeoutRef);

            if (uri == null) {
                clearTimeoutRef(maxTimeoutRef);
                setMousePos(null);
                return;
            }

            // Show after a short delay so fast mouse movements don't flicker.
            timeoutRef.current = window.setTimeout(() => {
                timeoutRef.current = null;
                setMousePos({ x: mouseX, y: mouseY });
                // Auto-dismiss after MaxHoverTimeMs so the tooltip doesn't linger forever.
                clearTimeoutRef(maxTimeoutRef);
                maxTimeoutRef.current = window.setTimeout(() => {
                    maxTimeoutRef.current = null;
                    setMousePos(null);
                }, MaxHoverTimeMs);
            }, HoverDelayMs);
        };

        return () => {
            termWrap.onLinkHover = null;
            clearTimeoutRef(timeoutRef);
            clearTimeoutRef(maxTimeoutRef);
            setMousePos(null);
        };
    }, [termWrap]);

    return <TermTooltip mousePos={mousePos} content={<span>{modKey}-click to open link</span>} />;
});
