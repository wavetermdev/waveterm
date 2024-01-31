import * as React from "react";
import { GlobalModel } from "../../../model/model";
import { Choose, When, If } from "tsx-control-statements";
import { Modal, PasswordField, Markdown } from "../common";
import { UserInputRequest } from "../../../types/types";

import "./userinput.less";

export const UserInputModal = (userInputRequest: UserInputRequest) => {
    const [responseText, setResponseText] = React.useState(null);

    const closeModal = React.useCallback(() => {
        console.log(userInputRequest);
        GlobalModel.sendUserInput({
            type: "userinputresp",
            requestid: userInputRequest.requestid,
            errormsg: "canceled",
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

    return (
        <Modal className="userinput-modal">
            <Modal.Header onClose={closeModal} title={"title"} />
            <div className="wave-modal-body">
                <If condition={false}>
                    <Markdown text={userInputRequest.querytext} />
                </If>
                <If condition={!false}>{userInputRequest.querytext}</If>
                <Choose>
                    <When condition={userInputRequest.responsetype == "string"}>
                        <PasswordField
                            placeholder="password"
                            onChange={setResponseText}
                            value={responseText}
                            maxLength={400}
                        />
                    </When>
                </Choose>
            </div>
            <Choose>
                <When condition={userInputRequest.responsetype == "string"}>
                    <Modal.Footer onCancel={closeModal} onOk={handleSendText} okLabel="Connect" />
                </When>
                <When condition={userInputRequest.responsetype == "bool"}>
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
