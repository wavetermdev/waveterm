// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MagnifyIcon } from "@/app/element/magnify";
import { WaveStreamdown } from "@/app/element/streamdown";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { cn, makeIconClass } from "@/util/util";
import { useLayoutEffect, useRef, useState } from "react";

export type FakeBlockProps = {
    icon: string;
    name: string;
    highlighted?: boolean;
    className?: string;
    markdown?: string;
    imgsrc?: string;
    editorText?: string;
};

export const FakeBlock = ({ icon, name, highlighted, className, markdown, imgsrc, editorText }: FakeBlockProps) => {
    return (
        <div
            className={cn(
                "w-full h-full bg-background rounded flex flex-col overflow-hidden border-2",
                highlighted ? "border-accent" : "border-border/50",
                className
            )}
        >
            <div className="flex items-center gap-2 px-2 py-1.5 bg-border/20 border-b border-border/50">
                <i className={makeIconClass(icon, false) + " text-xs text-foreground/70"} />
                <span className="text-xs text-foreground/70 flex-1">{name}</span>
                <span className="inline-block [&_svg]:fill-foreground/50 [&_svg_path]:!fill-foreground/50">
                    <MagnifyIcon enabled={false} />
                </span>
                <i className={makeIconClass("xmark-large", false) + " text-xs text-foreground/50"} />
            </div>
            <div className="flex-1 flex items-center justify-center overflow-auto p-4">
                {editorText ? (
                    <div className="w-full h-full">
                        <CodeEditor blockId="fake-block" text={editorText} readonly={true} language="shell" />
                    </div>
                ) : imgsrc ? (
                    <img src={imgsrc} alt={name} className="max-w-full max-h-full object-contain" />
                ) : markdown ? (
                    <div className="w-full">
                        <WaveStreamdown text={markdown} />
                    </div>
                ) : (
                    <i className={makeIconClass(icon, false) + " text-4xl text-foreground/50"} />
                )}
            </div>
        </div>
    );
};

export const FakeLayout = () => {
    const layoutRef = useRef<HTMLDivElement>(null);
    const highlightedContainerRef = useRef<HTMLDivElement>(null);
    const [blockRect, setBlockRect] = useState<{ left: number; top: number; width: number; height: number } | null>(
        null
    );
    const [isExpanded, setIsExpanded] = useState(false);

    useLayoutEffect(() => {
        if (highlightedContainerRef.current) {
            const elem = highlightedContainerRef.current;
            setBlockRect({
                left: elem.offsetLeft,
                top: elem.offsetTop,
                width: elem.offsetWidth,
                height: elem.offsetHeight,
            });
        }
    }, []);

    useLayoutEffect(() => {
        if (!blockRect) return;

        const timeouts: NodeJS.Timeout[] = [];

        const addTimeout = (callback: () => void, delay: number) => {
            const id = setTimeout(callback, delay);
            timeouts.push(id);
        };

        const runAnimationCycle = (isFirstRun: boolean) => {
            const initialDelay = isFirstRun ? 1500 : 3000;

            addTimeout(() => {
                setIsExpanded(true);
                addTimeout(() => {
                    setIsExpanded(false);
                    addTimeout(() => runAnimationCycle(false), 3000);
                }, 3200);
            }, initialDelay);
        };

        runAnimationCycle(true);

        return () => {
            timeouts.forEach(clearTimeout);
        };
    }, [blockRect]);

    const getAnimatedStyle = () => {
        if (!blockRect || !layoutRef.current) {
            return {
                left: blockRect?.left ?? 0,
                top: blockRect?.top ?? 0,
                width: blockRect?.width ?? 0,
                height: blockRect?.height ?? 0,
            };
        }

        if (isExpanded) {
            const layoutWidth = layoutRef.current.offsetWidth;
            const layoutHeight = layoutRef.current.offsetHeight;
            const targetWidth = layoutWidth * 0.85;
            const targetHeight = layoutHeight * 0.85;

            return {
                left: (layoutWidth - targetWidth) / 2,
                top: (layoutHeight - targetHeight) / 2,
                width: targetWidth,
                height: targetHeight,
            };
        }

        return {
            left: blockRect.left,
            top: blockRect.top,
            width: blockRect.width,
            height: blockRect.height,
        };
    };

    return (
        <div ref={layoutRef} className="w-full h-[400px] flex flex-row gap-2 relative">
            <div className="flex-1">
                <FakeBlock icon="terminal" name="Terminal" />
            </div>
            <div className="flex-1 flex flex-col gap-2">
                <div className="flex-1">
                    <FakeBlock icon="globe" name="Web" />
                </div>
                <div className="flex-1" ref={highlightedContainerRef}>
                    <FakeBlock icon="terminal" name="Terminal" highlighted={true} className="opacity-0" />
                </div>
            </div>
            {blockRect && (
                <>
                    <div
                        className={cn(
                            "absolute inset-0 bg-black/50 transition-opacity duration-200",
                            isExpanded ? "opacity-100" : "opacity-0 pointer-events-none"
                        )}
                    />
                    <div className="absolute transition-all duration-200 ease-in-out" style={getAnimatedStyle()}>
                        <FakeBlock icon="terminal" name="Terminal" highlighted={true} />
                    </div>
                </>
            )}
        </div>
    );
};