// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { Markdown } from "@/element/markdown";
import { modalsModel } from "@/store/modalmodel";
import * as keyutil from "@/util/keyutil";
import { fireAndForget } from "@/util/util";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserInputService } from "../store/services";
import "./userinputmodal.scss";

const UserInputModal = (userInputRequest: UserInputRequest) => {
    const [responseText, setResponseText] = useState("");
    const [countdown, setCountdown] = useState(Math.floor(userInputRequest.timeoutms / 1000));
    const checkboxRef = useRef<HTMLInputElement>(null);

    const handleSendErrResponse = useCallback(() => {
        fireAndForget(() =>
            UserInputService.SendUserInputResponse({
                type: "userinputresp",
                requestid: userInputRequest.requestid,
                errormsg: "Canceled by the user",
            })
        );
        modalsModel.popModal();
    }, [responseText, userInputRequest]);

    const handleSendText = useCallback(() => {
        fireAndForget(() =>
            UserInputService.SendUserInputResponse({
                type: "userinputresp",
                requestid: userInputRequest.requestid,
                text: responseText,
                checkboxstat: checkboxRef?.current?.checked ?? false,
            })
        );
        modalsModel.popModal();
    }, [responseText, userInputRequest]);

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
            modalsModel.popModal();
        },
        [userInputRequest]
    );

    const handleSubmit = useCallback(() => {
        switch (userInputRequest.responsetype) {
            case "text":
                handleSendText();
                break;
            case "confirm":
                handleSendConfirm(true);
                break;
        }
    }, [handleSendConfirm, handleSendText, userInputRequest.responsetype]);

    const handleKeyDown = useCallback(
        (waveEvent: WaveKeyboardEvent): boolean => {
            if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                handleSendErrResponse();
                return;
            }
            if (keyutil.checkKeyPressed(waveEvent, "Enter")) {
                handleSubmit();
                return true;
            }
        },
        [handleSendErrResponse, handleSubmit]
    );

    const queryText = useMemo(() => {
        if (userInputRequest.markdown) {
            return <Markdown text={userInputRequest.querytext} className="userinput-markdown" />;
        }
        return <span className="userinput-text">{userInputRequest.querytext}</span>;
    }, [userInputRequest.markdown, userInputRequest.querytext]);

    const inputBox = useMemo(() => {
        if (userInputRequest.responsetype === "confirm") {
            return <></>;
        }
        return (
            <input
                type={userInputRequest.publictext ? "text" : "password"}
                onChange={(e) => setResponseText(e.target.value)}
                value={responseText}
                maxLength={400}
                className="userinput-inputbox"
                autoFocus={true}
                onKeyDown={(e) => keyutil.keydownWrapper(handleKeyDown)(e)}
            />
        );
    }, [userInputRequest.responsetype, userInputRequest.publictext, responseText, handleKeyDown, setResponseText]);

    const optionalCheckbox = useMemo(() => {
        if (userInputRequest.checkboxmsg == "") {
            return <></>;
        }
        return (
            <div className="userinput-checkbox-container">
                <div className="userinput-checkbox-row">
                    <input
                        type="checkbox"
                        id={`uicheckbox-${userInputRequest.requestid}`}
                        className="userinput-checkbox"
                        ref={checkboxRef}
                    />
                    <label htmlFor={`uicheckbox-${userInputRequest.requestid}}`}>{userInputRequest.checkboxmsg}</label>
                </div>
            </div>
        );
    }, []);

    useEffect(() => {
        let timeout: ReturnType<typeof setTimeout>;
        if (countdown <= 0) {
            timeout = setTimeout(() => {
                handleSendErrResponse();
            }, 300);
        } else {
            timeout = setTimeout(() => {
                setCountdown(countdown - 1);
            }, 1000);
        }
        return () => clearTimeout(timeout);
    }, [countdown]);

    const handleNegativeResponse = useCallback(() => {
        switch (userInputRequest.responsetype) {
            case "text":
                handleSendErrResponse();
                break;
            case "confirm":
                handleSendConfirm(false);
                break;
        }
    }, [userInputRequest.responsetype, handleSendErrResponse, handleSendConfirm]);

    return (
        <Modal
            onOk={() => handleSubmit()}
            onCancel={() => handleNegativeResponse()}
            onClose={() => handleSendErrResponse()}
            okLabel={userInputRequest.oklabel}
            cancelLabel={userInputRequest.cancellabel}
        >
            <div className="userinput-header">{userInputRequest.title + ` (${countdown}s)`}</div>
            <div className="userinput-body">
                {queryText}
                {inputBox}
                {optionalCheckbox}
            </div>
        </Modal>
    );
};

UserInputModal.displayName = "UserInputModal";

export { UserInputModal };
