// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { Markdown } from "@/element/markdown";
import { modalsModel } from "@/store/modalmodel";
import * as keyutil from "@/util/keyutil";

import { useCallback, useMemo, useRef, useState } from "react";
import "./tipsmodal.less";

const TipsModal = (tipsContent: UserInputRequest) => {
    const [responseText, setResponseText] = useState("");
    const checkboxStatus = useRef(false);

    const handleClose = useCallback(() => {
        modalsModel.popModal();
    }, []);

    const handleKeyDown = useCallback(
        (waveEvent: WaveKeyboardEvent): boolean => {
            if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                handleClose();
                return;
            }
            if (keyutil.checkKeyPressed(waveEvent, "Enter")) {
                handleClose();
                return true;
            }
        },
        [handleClose]
    );

    const queryText = useMemo(() => {
        if (tipsContent.markdown) {
            return <Markdown text={tipsContent.querytext} className="tips-markdown" />;
        }
        return <span className="tips-text">{tipsContent.querytext}</span>;
    }, [tipsContent.markdown, tipsContent.querytext]);

    const inputBox = useMemo(() => {
        if (tipsContent.responsetype === "confirm") {
            return <></>;
        }
        return (
            <input
                type={tipsContent.publictext ? "text" : "password"}
                onChange={(e) => setResponseText(e.target.value)}
                value={responseText}
                maxLength={400}
                className="tips-inputbox"
                autoFocus={true}
                onKeyDown={(e) => keyutil.keydownWrapper(handleKeyDown)(e)}
            />
        );
    }, [tipsContent.responsetype, tipsContent.publictext, responseText, handleKeyDown, setResponseText]);

    return (
        <Modal onOk={() => handleClose()} onCancel={() => handleClose()} onClose={() => handleClose()}>
            <div className="tips-header">{tipsContent.title}</div>
            <div className="tips-body">
                {queryText}
                {inputBox}
            </div>
        </Modal>
    );
};

TipsModal.displayName = "TipsModal";

export { TipsModal };
