// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Markdown } from "@/element/markdown";
import { modalsModel } from "@/store/modalmodel";
import * as keyutil from "@/util/keyutil";
import { fireAndForget } from "@/util/util";
import clsx from "clsx";
import { useCallback, useMemo, useRef, useState } from "react";
import { UserInputService } from "../store/services";
import "./userinputprompt.scss";

interface UserInputPromptProps extends UserInputRequest {
    blockId?: string;
}

const UserInputPrompt = (userInputRequest: UserInputPromptProps) => {
    const [responseText, setResponseText] = useState("");
    const checkboxRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const connName = userInputRequest.connname;
    const blockId = userInputRequest.blockId;

    const handleDismiss = useCallback(() => {
        console.log(`[PW-RESP] handleDismiss: connName=${connName} requestId=${userInputRequest.requestid}`);
        if (connName) {
            modalsModel.dismissUserInputPrompt(connName);
        } else {
            modalsModel.popModal();
        }
    }, [connName]);

    const handleSendErrResponse = useCallback(() => {
        // Include connname so the backend can cancel ALL auth prompts for this
        // connection (A3: two tabs sharing one password host).
        fireAndForget(() =>
            UserInputService.SendUserInputResponse({
                type: "userinputresp",
                requestid: userInputRequest.requestid,
                errormsg: "Canceled by the user",
                connname: connName,
            })
        );
        handleDismiss();
    }, [userInputRequest, handleDismiss, connName]);

    const handleSendText = useCallback(() => {
        console.log(`[PW-RESP] handleSendText: connName=${connName} requestId=${userInputRequest.requestid}`);
        fireAndForget(() =>
            UserInputService.SendUserInputResponse({
                type: "userinputresp",
                requestid: userInputRequest.requestid,
                text: responseText,
                checkboxstat: checkboxRef?.current?.checked ?? false,
                connname: connName,
            })
        );
        handleDismiss();
    }, [responseText, userInputRequest, handleDismiss, connName]);

    const handleSendConfirm = useCallback(
        (response: boolean) => {
            fireAndForget(() =>
                UserInputService.SendUserInputResponse({
                    type: "userinputresp",
                    requestid: userInputRequest.requestid,
                    confirm: response,
                    checkboxstat: checkboxRef?.current?.checked ?? false,
                })
            );
            handleDismiss();
        },
        [userInputRequest, handleDismiss]
    );

    const handleSendOption = useCallback(
        (option: string) => {
            fireAndForget(() =>
                UserInputService.SendUserInputResponse({
                    type: "userinputresp",
                    requestid: userInputRequest.requestid,
                    text: option,
                    connname: connName,
                })
            );
            handleDismiss();
        },
        [userInputRequest, handleDismiss, connName]
    );

    const handleSubmit = useCallback(() => {
        switch (userInputRequest.responsetype) {
            case "text":
                handleSendText();
                break;
            case "confirm":
                handleSendConfirm(true);
                break;
            case "options":
                // Options are selected by direct click; Enter has no default action.
                break;
        }
    }, [handleSendConfirm, handleSendText, userInputRequest.responsetype]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(e);
            if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                handleSendErrResponse();
                return;
            }
            if (keyutil.checkKeyPressed(waveEvent, "Enter")) {
                handleSubmit();
            }
        },
        [handleSendErrResponse, handleSubmit]
    );

    const queryText = useMemo(() => {
        if (userInputRequest.markdown) {
            return <Markdown text={userInputRequest.querytext} />;
        }
        return <span>{userInputRequest.querytext}</span>;
    }, [userInputRequest.markdown, userInputRequest.querytext]);

    const defaultTimeoutHint = useMemo(() => {
        if (!userInputRequest.defaultoption) {
            return null;
        }
        const timeoutMs = userInputRequest.timeoutms;
        const timeoutSec = timeoutMs > 0 ? Math.round(timeoutMs / 1000) : 60;
        return (
            <div className="text-xs text-white/50">
                If you don't answer, this will default to {userInputRequest.defaultoption} in {timeoutSec}s
            </div>
        );
    }, [userInputRequest.defaultoption, userInputRequest.timeoutms]);

    const inputBox = useMemo(() => {
        if (userInputRequest.responsetype === "confirm" || userInputRequest.responsetype === "options") {
            return <></>;
        }
        return (
            <input
                ref={inputRef}
                type={userInputRequest.publictext ? "text" : "password"}
                onChange={(e) => setResponseText(e.target.value)}
                value={responseText}
                maxLength={400}
                className="resize-none bg-panel rounded-md border border-border py-1.5 pl-4 min-h-[30px] text-inherit cursor-text focus:ring-2 focus:ring-accent focus:outline-none"
                autoFocus={true}
                aria-label={userInputRequest.title || "Password input"}
                onKeyDown={handleKeyDown}
            />
        );
    }, [userInputRequest.responsetype, userInputRequest.publictext, responseText, handleKeyDown, setResponseText]);

    const optionalCheckbox = useMemo(() => {
        if (userInputRequest.checkboxmsg == "") {
            return <></>;
        }
        return (
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                    <input
                        type="checkbox"
                        id={`uicheckbox-${userInputRequest.requestid}`}
                        className="accent-accent cursor-pointer"
                        ref={checkboxRef}
                    />
                    <label htmlFor={`uicheckbox-${userInputRequest.requestid}`} className="cursor-pointer">{userInputRequest.checkboxmsg}</label>
                </div>
            </div>
        );
    }, []);

    const optionsBox = useMemo(() => {
        if (userInputRequest.responsetype !== "options") {
            return <></>;
        }
        return (
            <div className="flex flex-col gap-1.5">
                {(userInputRequest.options ?? []).map((option, idx) => (
                    <Button key={`${option}-${idx}`} className="grey" onClick={() => handleSendOption(option)}>
                        {option}
                    </Button>
                ))}
            </div>
        );
    }, [userInputRequest.responsetype, userInputRequest.options, handleSendOption]);

    const handleNegativeResponse = useCallback(() => {
        switch (userInputRequest.responsetype) {
            case "text":
            case "options":
                handleSendErrResponse();
                break;
            case "confirm":
                handleSendConfirm(false);
                break;
        }
    }, [userInputRequest.responsetype, handleSendErrResponse, handleSendConfirm]);

    const renderPrompt = () => {
        // UX-1.8: Visual differentiation based on prompt type
        let headerIcon: string | null = null;
        let headerAccentClass = "";
        if (userInputRequest.prompttype === "password") {
            headerIcon = "fa-solid fa-key";
            headerAccentClass = "text-warning";
        } else if (userInputRequest.prompttype === "passphrase") {
            headerIcon = "fa-solid fa-lock";
            headerAccentClass = "text-sky-400";
        } else if (userInputRequest.prompttype === "keyboard-interactive") {
            headerIcon = "fa-solid fa-circle-question";
            headerAccentClass = "text-warning";
        }

        return (
        <div className="userinput-prompt-wrapper">
            <div className="userinput-prompt" onKeyDown={handleKeyDown}>
                <div className="userinput-prompt-header">
                    {headerIcon && <i className={clsx(headerIcon, headerAccentClass, "mr-2 text-sm")}></i>}
                    <div className="font-bold text-primary">{userInputRequest.title}</div>
                    {/* UX-1.6: Queue position indicator for multi-connection password prompts */}
                    {(userInputRequest.queuetotal ?? 1) > 1 && (
                        <span className="text-[10px] text-white/50 ml-2">
                            ({userInputRequest.queueposition ?? 1} of {userInputRequest.queuetotal})
                        </span>
                    )}
                </div>
                <div className="userinput-prompt-body">
                    {queryText}
                    {defaultTimeoutHint}
                    {inputBox}
                    {optionsBox}
                    {optionalCheckbox}
                </div>
                {userInputRequest.responsetype !== "options" && (
                    <div className="userinput-prompt-footer">
                        <Button className="grey ghost" onClick={handleNegativeResponse}>
                            {userInputRequest.cancellabel || "Cancel"}
                        </Button>
                        <Button onClick={() => handleSubmit()}>
                            {userInputRequest.oklabel || "Ok"}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
    };

    return renderPrompt();
};

UserInputPrompt.displayName = "UserInputPrompt";

export { UserInputPrompt };
