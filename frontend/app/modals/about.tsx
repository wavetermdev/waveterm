// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { modalsModel } from "@/app/store/modalmodel";
import { Modal } from "./modal";

import { isDev } from "@/util/isdev";
import { useState } from "react";
import { getApi } from "../store/global";

interface AboutModalVProps {
    versionString: string;
    updaterChannel: string;
    onClose: () => void;
}

const AboutModalV = ({ versionString, updaterChannel, onClose }: AboutModalVProps) => {
    const currentDate = new Date();

    return (
        <Modal className="pt-[34px] pb-[34px]" onClose={onClose}>
            <div className="flex flex-col gap-[26px] w-full">
                <div className="flex flex-col items-center justify-center gap-4 self-stretch w-full text-center">
                    <Logo />
                    <div className="text-[25px]">Wave Terminal</div>
                    <div className="leading-5">
                        Open-Source AI-Native Terminal
                        <br />
                        Built for Seamless Workflows
                    </div>
                </div>
                <div className="items-center gap-4 self-stretch w-full text-center">
                    Client Version {versionString}
                    <br />
                    Update Channel: {updaterChannel}
                </div>
                <div className="flex items-start gap-[10px] self-stretch w-full text-center">
                    <a
                        href="https://github.com/wavetermdev/waveterm?ref=about"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-brands fa-github mr-2"></i>Github
                    </a>
                    <a
                        href="https://www.waveterm.dev/?ref=about"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-sharp fa-light fa-globe mr-2"></i>Website
                    </a>
                    <a
                        href="https://github.com/wavetermdev/waveterm/blob/main/ACKNOWLEDGEMENTS.md"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-sharp fa-light fa-heart mr-2"></i>Acknowledgements
                    </a>
                </div>
                <div className="items-center gap-4 self-stretch w-full text-center">
                    &copy; {currentDate.getFullYear()} Command Line Inc.
                </div>
            </div>
        </Modal>
    );
};

AboutModalV.displayName = "AboutModalV";

const AboutModal = () => {
    const [details] = useState(() => getApi().getAboutModalDetails());
    const [updaterChannel] = useState(() => getApi().getUpdaterChannel());
    const versionString = `${details.version} (${isDev() ? "dev-" : ""}${details.buildTime})`;

    return (
        <AboutModalV
            versionString={versionString}
            updaterChannel={updaterChannel}
            onClose={() => modalsModel.popModal()}
        />
    );
};

AboutModal.displayName = "AboutModal";

export { AboutModal, AboutModalV };
