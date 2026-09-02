// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CopyButton } from "@/app/element/copybutton";
import clsx from "clsx";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

const buttonClassName = "outlined grey text-[11px] py-[3px] px-[7px]";
const destructiveButtonClassName = "solid red text-[11px] py-[3px] px-[7px]";
const highlightedButtonClassName = "ring-2 ring-accent";
const EMPTY_BUTTONS: ErrorButtonDef[] = [];

export const ErrorOverlay = memo(({ errorMsg, resetOverlay, className }: { errorMsg: ErrorMsg; resetOverlay: () => void; className?: string }) => {
    const showDismiss = errorMsg.showDismiss ?? true;

    let iconClass = "fa-solid fa-circle-exclamation text-error text-base";
    if (errorMsg.level == "warning") {
        iconClass = "fa-solid fa-triangle-exclamation text-warning text-base";
    }

    const handleCopyToClipboard = useCallback(async () => {
        await navigator.clipboard.writeText(errorMsg.text);
    }, [errorMsg.text]);

    const buttons = errorMsg.buttons ?? EMPTY_BUTTONS;
    const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

    // The destructive affirmative is the default focused button. When no button
    // is flagged destructive, fall back to the first button.
    const [highlightIndex, setHighlightIndex] = useState<number>(() => {
        const destructiveIdx = buttons.findIndex((btn) => btn.destructive);
        return destructiveIdx !== -1 ? destructiveIdx : 0;
    });

    // Focus the default (destructive) button whenever the overlay mounts or the
    // errorMsg is replaced, and keep the highlight in sync with it.
    useEffect(() => {
        const list = errorMsg.buttons ?? EMPTY_BUTTONS;
        const destructiveIdx = list.findIndex((btn) => btn.destructive);
        const initialIdx = destructiveIdx !== -1 ? destructiveIdx : 0;
        setHighlightIndex(initialIdx);
        buttonRefs.current[initialIdx]?.focus();
    }, [errorMsg]);

    const activateButton = useCallback(
        (idx: number) => {
            const buttonDef = buttons[idx];
            if (buttonDef == null) {
                return;
            }
            buttonDef.onClick();
            resetOverlay();
        },
        [buttons, resetOverlay]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            const buttonCount = buttons.length;
            if (e.key === "Tab" && buttonCount > 0) {
                e.preventDefault();
                const direction = e.shiftKey ? -1 : 1;
                const nextIdx = (highlightIndex + direction + buttonCount) % buttonCount;
                setHighlightIndex(nextIdx);
                buttonRefs.current[nextIdx]?.focus();
                return;
            }
            if ((e.key === "Enter" || e.key === " ") && buttonCount > 0) {
                e.preventDefault();
                activateButton(highlightIndex);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                resetOverlay();
                return;
            }
            // All other keys bubble up to the directory keydown guard, which
            // swallows them while a confirm dialog is open.
        },
        [buttons, highlightIndex, activateButton, resetOverlay]
    );

    return (
        <div
            className={clsx(
                "absolute top-[0] left-1.5 right-1.5 overflow-hidden bg-[var(--conn-status-overlay-bg-color)] backdrop-blur-[50px] rounded-md shadow-lg",
                className ?? "z-[var(--zindex-block-mask-inner)]"
            )}
            onKeyDown={handleKeyDown}
        >
            <div className="flex flex-row justify-between p-2.5 pl-3 font-normal text-sm leading-normal font-sans text-secondary">
                <div
                    className={clsx("flex flex-row items-center gap-3 grow min-w-0 shrink", {
                        "items-start": true,
                    })}
                >
                    <i className={iconClass}></i>

                    <div className="flex flex-col items-start gap-1 grow w-full shrink min-w-0">
                        <div className="max-w-full text-xs font-semibold leading-4 tracking-[0.11px] text-white overflow-hidden">
                            {errorMsg.status}
                        </div>

                        <OverlayScrollbarsComponent
                            className="group text-xs font-normal leading-[15px] tracking-[0.11px] text-wrap max-h-20 rounded-lg py-1.5 pl-0 relative w-full"
                            options={{ scrollbars: { autoHide: "leave" } }}
                        >
                            <CopyButton
                                className="invisible group-hover:visible flex absolute top-0 right-1 rounded backdrop-blur-lg p-1 items-center justify-end gap-1"
                                onClick={handleCopyToClipboard}
                                title="Copy"
                            />
                            <div>{errorMsg.text}</div>
                        </OverlayScrollbarsComponent>
                        {buttons.length > 0 && (
                            <div className="flex flex-row gap-2">
                                {buttons.map((buttonDef, i) => (
                                    <Button
                                        className={clsx(
                                            buttonDef.destructive ? destructiveButtonClassName : buttonClassName,
                                            i === highlightIndex && highlightedButtonClassName
                                        )}
                                        onClick={() => activateButton(i)}
                                        onFocus={() => setHighlightIndex(i)}
                                        ref={(el) => {
                                            buttonRefs.current[i] = el;
                                        }}
                                        key={i}
                                    >
                                        {buttonDef.text}
                                    </Button>
                                ))}
                            </div>
                        )}
                    </div>

                    {showDismiss && (
                        <div className="flex items-start">
                            <Button
                                className={clsx(buttonClassName, "fa-xmark fa-solid")}
                                onClick={() => {
                                    if (errorMsg.closeAction) {
                                        errorMsg.closeAction();
                                    }
                                    resetOverlay();
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});
