// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { GlobalModel } from "@/models";
import { TosModal } from "./tos";

@mobxReact.observer
class ModalsProvider extends React.PureComponent {
    render() {
        const store = GlobalModel.modalsModel.store.slice();
        if (GlobalModel.needsTos()) {
            return <TosModal />;
        }
        const rtn: React.JSX.Element[] = [];
        for (const entry of store) {
            const Comp = entry.component;
            rtn.push(<Comp key={entry.uniqueKey} {...entry.props} />);
        }
        return <>{rtn}</>;
    }
}

export { ModalsProvider };
