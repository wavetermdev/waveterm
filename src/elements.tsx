import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import cn from "classnames";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";

function renderCmdText(text : string) : any {
    return <span>&#x2318;{text}</span>;
}

class CmdStrCode extends React.Component<{cmdstr : string, onUse : () => void, onCopy : () => void, isCopied : boolean, fontSize : "normal" | "large", limitHeight : boolean}, {}> {
    @boundMethod
    handleUse(e : any) {
        e.stopPropagation();
        if (this.props.onUse != null) {
            this.props.onUse()
        }
    }

    @boundMethod
    handleCopy(e : any) {
        e.stopPropagation();
        if (this.props.onCopy != null) {
            this.props.onCopy();
        }
    }

    render() {
        let {isCopied, cmdstr, fontSize, limitHeight} = this.props;
        return (
            <div className={cn("cmdstr-code", {"is-large": (fontSize == "large")}, {"limit-height": limitHeight})}>
                <If condition={isCopied}>
                    <div key="copied" className="copied-indicator">
                        <div>copied</div>
                    </div>
                </If>
                <div key="use" className="use-button" title="Use Command" onClick={this.handleUse}><i className="fa-sharp fa-solid fa-check"/></div>
                <div key="code" className="code-div">
                    <code>{cmdstr}</code>
                </div>
                <div key="copy" className="copy-control">
                    <div className="inner-copy" onClick={this.handleCopy}>
                        <i title="copy" className="fa-sharp fa-regular fa-copy"/>
                    </div>
                </div>
            </div>
        );
    }
}

class Toggle extends React.Component<{checked : boolean, onChange : (value : boolean) => void}, {}> {
    @boundMethod
    handleChange(e : any) : void {
        let {onChange} = this.props;
        if (onChange != null) {
            onChange(e.target.checked);
        }
    }
    
    render() {
        return (
            <label className="checkbox-toggle">
                <input type="checkbox" checked={this.props.checked} onChange={this.handleChange}/>
                <span className="slider"/>
            </label>
        );
    }
}

export {CmdStrCode, Toggle, renderCmdText};
