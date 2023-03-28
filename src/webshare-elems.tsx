import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";

class WebShareMain extends React.Component<{}, {}> {
    render() {
        return (
            <h1>hello from webshare</h1>
        );
    }
}

export {WebShareMain};
