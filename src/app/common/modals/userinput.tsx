import * as React from "react";
import { GlobalModel } from "@/models";
import { Choose, When, If } from "tsx-control-statements/components";
import { Modal, PasswordField, Markdown } from "@/elements";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";

import "./userinput.less";

export const UserInputModal = (userInputRequest: UserInputRequest) => {
    const [responseText, setResponseText] = React.useState("");
    const [countdown, setCountdown] = React.useState(Math.floor(userInputRequest.timeoutms / 1000));

    const handleSendCancel = React.useCallback(() => {
        GlobalModel.sendUserInput({
            type: "userinputresp",
            requestid: userInputRequest.requestid,
            errormsg: "Canceled by the user",
        });
        GlobalModel.remotesModel.closeModal();
    }, [responseText, userInputRequest]);

    const handleSendText = React.useCallback(() => {
        GlobalModel.sendUserInput({
            type: "userinputresp",
            requestid: userInputRequest.requestid,
            text: responseText,
        });
        GlobalModel.remotesModel.closeModal();
    }, [responseText, userInputRequest]);

    const handleSendConfirm = React.useCallback(
        (response: boolean) => {
            GlobalModel.sendUserInput({
                type: "userinputresp",
                requestid: userInputRequest.requestid,
                confirm: response,
            });
            GlobalModel.remotesModel.closeModal();
        },
        [userInputRequest]
    );

    function handleTextKeyDown(e: any) {
        let waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (checkKeyPressed(waveEvent, "Enter")) {
            e.preventDefault();
            e.stopPropagation();
            handleSendText();
        } else if (checkKeyPressed(waveEvent, "Escape")) {
            e.preventDefault();
            e.stopPropagation();
            handleSendCancel();
        }
    }

    React.useEffect(() => {
        let timeout: ReturnType<typeof setTimeout>;
        if (countdown == 0) {
            timeout = setTimeout(() => {
                GlobalModel.remotesModel.closeModal();
            }, 300);
        } else {
            timeout = setTimeout(() => {
                setCountdown(countdown - 1);
            }, 1000);
        }
        return () => clearTimeout(timeout);
    }, [countdown]);

    return (
        <Modal className="userinput-modal">
            <Modal.Header onClose={handleSendCancel} title={userInputRequest.title + ` (${countdown}s)`} />
            <div className="wave-modal-body">
                <div className="userinput-query">
                    <If condition={userInputRequest.markdown}>
                        <Markdown text={userInputRequest.querytext} extraClassName="bottom-margin" />
                    </If>
                    <If condition={!userInputRequest.markdown}>{userInputRequest.querytext}</If>
                </div>
                <Choose>
                    <When condition={userInputRequest.responsetype == "text"}>
                        <PasswordField
                            onChange={setResponseText}
                            value={responseText}
                            maxLength={400}
                            autoFocus={true}
                            onKeyDown={(e) => handleTextKeyDown(e)}
                        />
                    </When>
                </Choose>
            </div>
            <Choose>
                <When condition={userInputRequest.responsetype == "text"}>
                    <Modal.Footer onCancel={handleSendCancel} onOk={handleSendText} okLabel="Continue" />
                </When>
                <When condition={userInputRequest.responsetype == "confirm"}>
                    <Modal.Footer
                        onCancel={() => handleSendConfirm(false)}
                        onOk={() => handleSendConfirm(true)}
                        okLabel="Yes"
                        cancelLabel="No"
                    />
                </When>
            </Choose>
        </Modal>
    );
};
