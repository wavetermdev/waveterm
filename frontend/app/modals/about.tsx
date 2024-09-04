// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { LinkButton } from "@/app/element/linkbutton";
import { modalsModel } from "@/app/store/modalmodel";
import { Modal } from "./modal";

import { isDev } from "@/util/isdev";
import { useState } from "react";
import { getApi } from "../store/global";
import "./about.less";

interface AboutModalProps {}

const AboutModal = ({}: AboutModalProps) => {
    const currentDate = new Date();
    const [details] = useState(() => getApi().getAboutModalDetails());

    return (
        <Modal className="about-modal" onClose={() => modalsModel.popModal()}>
            <div className="section-wrapper">
                <div className="section logo-section">
                    <Logo />
                    <div className="app-name">Wave Terminal</div>
                    <div className="text-standard">
                        Open-Source AI-Native Terminal
                        <br />
                        Built for Seamless Workflows
                    </div>
                </div>
                <div className="section text-standard">
                    Client Version {details.version} ({isDev() ? "dev-" : ""}
                    {details.buildTime})
                </div>
                <div className="section">
                    <LinkButton
                        className="secondary solid"
                        href="https://github.com/wavetermdev/waveterm"
                        target="_blank"
                        leftIcon={<i className="fa-brands fa-github"></i>}
                    >
                        Github
                    </LinkButton>
                    <LinkButton
                        className="secondary solid"
                        href="https://www.waveterm.dev/"
                        target="_blank"
                        leftIcon={<i className="fa-sharp fa-light fa-globe"></i>}
                    >
                        Website
                    </LinkButton>
                    <LinkButton
                        className="secondary solid"
                        href="https://github.com/wavetermdev/waveterm/blob/main/acknowledgements/README.md"
                        target="_blank"
                        rel={"noopener"}
                        leftIcon={<i className="fa-sharp fa-light fa-heart"></i>}
                    >
                        Acknowledgements
                    </LinkButton>
                </div>
                <div className="section text-standard">&copy; {currentDate.getFullYear()} Command Line Inc.</div>
            </div>
        </Modal>
    );
};

AboutModal.displayName = "AboutModal";

export { AboutModal };
