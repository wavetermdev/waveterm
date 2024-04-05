import * as React from "react";
import { Button } from "./button";
import { boundMethod } from "autobind-decorator";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";

import "./copybutton.less";

type CopyButtonProps = {
    title: string;
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

@mobxReact.observer
class CopyButton extends React.Component<CopyButtonProps, {}> {
    isCopied: OV<boolean> = mobx.observable.box(false, { name: "isCopied" });

    @boundMethod
    handleOnClick(e: React.MouseEvent<HTMLButtonElement>) {
        if (this.isCopied.get()) {
            return;
        }
        mobx.action(() => {
            this.isCopied.set(true);
        })();
        setTimeout(() => {
            mobx.action(() => {
                this.isCopied.set(false);
            })();
        }, 2000);
        if (this.props.onClick) {
            this.props.onClick(e);
        }
    }

    render() {
        const { title, onClick } = this.props;
        const isCopied = this.isCopied.get();
        return (
            <Button onClick={this.handleOnClick} className="copy-button secondary ghost" title={title}>
                {isCopied ? (
                    <i className="fa-sharp fa-solid fa-check"></i>
                ) : (
                    <i className="fa-sharp fa-solid fa-copy"></i>
                )}
            </Button>
        );
    }
}

export { CopyButton };
