// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { GlobalModel } from "@/models";
import { TosModal } from "./tos";
import { NewWaveModal } from "./newwave";

const SessionStorageKey = "newWaveRendered";

@mobxReact.observer
class ModalsProvider extends React.Component<{}, {}> {
    constructor(props) {
        super(props);
        this.handleNewWaveOnClose = this.handleNewWaveOnClose.bind(this);
    }

    handleNewWaveOnClose() {
        sessionStorage.setItem(SessionStorageKey, "1");
        this.forceUpdate();
    }

    render() {
        let store = GlobalModel.modalsModel.store.slice();

        if (GlobalModel.needsTos()) {
            return <TosModal />;
        }

        const newWaveRendered = sessionStorage.getItem(SessionStorageKey);
        if (!newWaveRendered) {
            return <NewWaveModal onClose={this.handleNewWaveOnClose} />;
        }

        let rtn: JSX.Element[] = [];
        for (let i = 0; i < store.length; i++) {
            let entry = store[i];
            let Comp = entry.component;
            rtn.push(<Comp key={entry.uniqueKey} {...entry.props} />);
        }
        return <>{rtn}</>;
    }
}

export { ModalsProvider };
