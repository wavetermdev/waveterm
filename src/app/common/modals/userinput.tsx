import * as React from "react";
import { GlobalModel } from "../../../models";
import { Choose, When, If } from "tsx-control-statements";
import { Modal, PasswordField, Markdown } from "../elements";
import { UserInputRequest } from "../../../types/types";

import "./userinput.less";

export const UserInputModal = (userInputRequest: UserInputRequest) => {
    const [responseText, setResponseText] = React.useState("");
    const [countdown, setCountdown] = React.useState(Math.floor(userInputRequest.timeoutms / 1000));

    const closeModal = React.useCallback(() => {
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
            <Modal.Header onClose={closeModal} title={userInputRequest.title + ` (${countdown})`} />
            <div className="wave-modal-body">
                <div className="userinput-query">
                    <If condition={userInputRequest.markdown}>
                        <Markdown text={userInputRequest.querytext} />
                    </If>
                    <If condition={!userInputRequest.markdown}>{userInputRequest.querytext}</If>
                </div>
                <Choose>
                    <When condition={userInputRequest.responsetype == "text"}>
                        <PasswordField onChange={setResponseText} value={responseText} maxLength={400} />
                    </When>
                </Choose>
            </div>
            <Choose>
                <When condition={userInputRequest.responsetype == "text"}>
                    <Modal.Footer onCancel={closeModal} onOk={handleSendText} okLabel="Continue" />
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
