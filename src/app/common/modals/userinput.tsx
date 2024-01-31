import * as React from "react";
import { GlobalModel } from "../../../model/model";
import { Choose, When, If } from "tsx-control-statements";
import { Modal, PasswordField, Markdown } from "../common";
import { GlobalCommandRunner } from "../../../model/model";
import { UserInputRequest, UserInputResponse, UserInputResponsePacket } from "../../../types/types";

import "./userinput.less";

export const UserInputModal = (userInputRequest: UserInputRequest) => {
    const [responseText, setResponseText] = React.useState(null);

    const closeModal = React.useCallback(() => {
        const userInputResponse: UserInputResponse = {
            type: userInputRequest.responsetype,
        };
        GlobalCommandRunner.sendUserInput({
            type: "userinputresp",
            requestid: userInputRequest.requestid,
            response: userInputResponse,
        });
        GlobalModel.remotesModel.closeModal();
    }, [responseText, userInputRequest]);

    const handleSendText = React.useCallback(() => {
        const userInputResponse: UserInputResponse = {
            type: userInputRequest.responsetype,
            text: responseText,
        };
        GlobalCommandRunner.sendUserInput({
            type: "userinputresp",
            requestid: userInputRequest.requestid,
            response: userInputResponse,
        });
        GlobalModel.remotesModel.closeModal();
    }, [responseText, userInputRequest]);

    const handleSendConfirm = React.useCallback(
        (response: boolean) => {
            const userInputResponse: UserInputResponse = {
                type: userInputRequest.responsetype,
                confirm: response,
            };
            GlobalCommandRunner.sendUserInput({
                type: "userinputresp",
                requestid: userInputRequest.requestid,
                response: userInputResponse,
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
                    <When condition={(userInputRequest.responsetype = "string")}>
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
                <When condition={(userInputRequest.responsetype = "string")}>
                    <Modal.Footer onCancel={closeModal} onOk={handleSendText} okLabel="Connect" />
                </When>
                <When condition={(userInputRequest.responsetype = "bool")}>
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
