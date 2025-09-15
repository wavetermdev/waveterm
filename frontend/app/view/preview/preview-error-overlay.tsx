// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CopyButton } from "@/app/element/copybutton";
import clsx from "clsx";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { memo, useCallback } from "react";

export const ErrorOverlay = memo(({ errorMsg, resetOverlay }: { errorMsg: ErrorMsg; resetOverlay: () => void }) => {
    const showDismiss = errorMsg.showDismiss ?? true;
    const buttonClassName = "outlined grey font-size-11 vertical-padding-3 horizontal-padding-7";

    let iconClass = "fa-solid fa-circle-exclamation text-error text-base";
    if (errorMsg.level == "warning") {
        iconClass = "fa-solid fa-triangle-exclamation text-warning text-base";
    }

    const handleCopyToClipboard = useCallback(async () => {
        await navigator.clipboard.writeText(errorMsg.text);
    }, [errorMsg.text]);

    return (
        <div className="absolute top-[0] left-1.5 right-1.5 z-[var(--zindex-block-mask-inner)] overflow-hidden bg-[var(--conn-status-overlay-bg-color)] backdrop-blur-[50px] rounded-md shadow-lg">
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
                        {!!errorMsg.buttons && (
                            <div className="flex flex-row gap-2">
                                {errorMsg.buttons?.map((buttonDef) => (
                                    <Button
                                        className={buttonClassName}
                                        onClick={() => {
                                            buttonDef.onClick();
                                            resetOverlay();
                                        }}
                                        key={crypto.randomUUID()}
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
