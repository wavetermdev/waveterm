import * as React from "react";
import { GlobalModel } from "@/models";
import { Choose, When, If } from "tsx-control-statements/components";
import { Modal, PasswordField, TextField, Markdown, Checkbox } from "@/elements";

import "./userinput.less";

export const UserInputModal: React.FunctionComponent<UserInputRequest> = (userInputRequest: UserInputRequest) => {
    const [responseText, setResponseText] = React.useState("");
    const [countdown, setCountdown] = React.useState(Math.floor(userInputRequest.timeoutms / 1000));
    const checkboxStatus = React.useRef(false);

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
            checkboxstat: checkboxStatus.current,
        });
        GlobalModel.remotesModel.closeModal();
    }, [responseText, userInputRequest]);

    const handleSendConfirm = React.useCallback(
        (response: boolean) => {
            console.log(`checkbox ${checkboxStatus}\n\n`);
            GlobalModel.sendUserInput({
                type: "userinputresp",
                requestid: userInputRequest.requestid,
                confirm: response,
                checkboxstat: checkboxStatus.current,
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
            <Modal.Header onClose={handleSendCancel} title={userInputRequest.title + ` (${countdown}s)`} />
            <div className="wave-modal-body">
                <div className="wave-modal-dialog">
                    <div className="userinput-query">
                        <If condition={userInputRequest.markdown}>
                            <Markdown text={userInputRequest.querytext} extraClassName="bottom-margin" />
                        </If>
                        <If condition={!userInputRequest.markdown}>{userInputRequest.querytext}</If>
                    </div>
                    <If condition={userInputRequest.responsetype == "text"}>
                        <If condition={userInputRequest.publictext}>
                            <TextField
                                onChange={setResponseText}
                                value={responseText}
                                maxLength={400}
                                autoFocus={true}
                            />
                        </If>
                        <If condition={!userInputRequest.publictext}>
                            <PasswordField
                                onChange={setResponseText}
                                value={responseText}
                                maxLength={400}
                                autoFocus={true}
                            />
                        </If>
                    </If>
                </div>
                <If condition={userInputRequest.checkboxmsg != ""}>
                    <Checkbox
                        onChange={() => (checkboxStatus.current = !checkboxStatus.current)}
                        label={userInputRequest.checkboxmsg}
                        className="checkbox-text"
                    />
                </If>
            </div>
            <Choose>
                <When condition={userInputRequest.responsetype == "text"}>
                    <Modal.Footer
                        onCancel={handleSendCancel}
                        onOk={handleSendText}
                        okLabel="Continue"
                        keybindings={true}
                    />
                </When>
                <When condition={userInputRequest.responsetype == "confirm"}>
                    <Modal.Footer
                        onCancel={() => handleSendConfirm(false)}
                        onOk={() => handleSendConfirm(true)}
                        okLabel="Yes"
                        cancelLabel="No"
                        keybindings={true}
                    />
                </When>
            </Choose>
        </Modal>
    );
};
