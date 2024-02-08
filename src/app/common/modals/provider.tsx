// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { GlobalModel } from "../../../model/model_old";
import { TosModal } from "./tos";

@mobxReact.observer
class ModalsProvider extends React.Component {
    render() {
        let store = GlobalModel.modalsModel.store.slice();
        if (GlobalModel.needsTos()) {
            return <TosModal />;
        }
        let rtn: JSX.Element[] = [];
        for (let i = 0; i < store.length; i++) {
            let entry = store[i];
            let Comp = entry.component;
            rtn.push(<Comp key={entry.uniqueKey} />);
        }
        return <>{rtn}</>;
    }
}

export { ModalsProvider };
