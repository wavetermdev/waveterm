// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { uxCloseBlock } from "@/app/store/keymodel";
import { DESKTOP_CHROME_USER_AGENT, WebView, WebViewModel } from "@/app/view/webview/webview";
import { fireAndForget } from "@/util/util";
import { atom } from "jotai";

const FeishuWebUrl = "https://www.feishu.cn/messenger/";
const FeishuPartition = "persist:feishu";

class FeishuWebViewModel extends WebViewModel {
    get viewComponent(): ViewComponent {
        return FeishuWebView;
    }

    constructor(initOpts: ViewModelInitType) {
        super(initOpts);
        this.viewType = "feishuweb";
        this.viewIcon = atom("globe");
        this.viewName = atom("Feishu Web");
        this.homepageUrl = atom(FeishuWebUrl);
        this.partitionOverride = atom(FeishuPartition);
        this.defaultUserAgent = atom(DESKTOP_CHROME_USER_AGENT);
        this.webPreferences = atom("nativeWindowOpen=yes");
        this.endIconButtons = atom((get) => {
            const currentUrl = get(this.url);
            const metaUrl = get(this.blockAtom)?.meta?.url;
            const homepageUrl = get(this.homepageUrl);
            const url = currentUrl ?? metaUrl ?? homepageUrl;
            return [
                {
                    elemtype: "iconbutton",
                    icon: "desktop",
                    title: "Open local Feishu app",
                    click: () => {
                        fireAndForget(() => this.env.electron.openFeishuApp());
                    },
                },
                {
                    elemtype: "iconbutton",
                    icon: "arrow-up-right-from-square",
                    title: "Open current page in external browser",
                    click: () => {
                        if (url != null && url !== "") {
                            this.env.electron.openExternal(url);
                        }
                    },
                },
                {
                    elemtype: "iconbutton",
                    icon: "eye-slash",
                    title: "Hide this Feishu Web card",
                    click: () => {
                        uxCloseBlock(this.blockId);
                    },
                },
            ];
        });
    }

    handleNewWindow(url: string) {
        fireAndForget(() =>
            this.env.createBlock({
                meta: {
                    view: "feishuweb",
                    url,
                },
            })
        );
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        return [
            {
                label: "Open Local Feishu App",
                click: () => {
                    fireAndForget(() => this.env.electron.openFeishuApp());
                },
            },
            {
                type: "separator",
            },
            ...super.getSettingsMenuItems(),
        ];
    }
}

function FeishuWebView(props: ViewComponentProps<FeishuWebViewModel>) {
    return (
        <div className="h-full w-full">
            <WebView {...props} />
        </div>
    );
}

export { FeishuWebViewModel };
