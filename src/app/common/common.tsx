// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import cn from "classnames";
import { If } from "tsx-control-statements/components";
import type { RemoteType } from "../../types/types";
import { debounce } from "throttle-debounce";

import { ReactComponent as CheckIcon } from "../assets/icons/line/check.svg";
import { ReactComponent as CopyIcon } from "../assets/icons/history/copy.svg";
import { ReactComponent as CircleIcon } from "../assets/icons/circle.svg";
import { ReactComponent as KeyIcon } from "../assets/icons/key.svg";
import { ReactComponent as XMarkIcon } from "../assets/icons/line/xmark.svg";
import { ReactComponent as RotateIcon } from "../assets/icons/rotate_left.svg";
import { ReactComponent as CircleInfoIcon } from "../assets/icons/circle_info.svg";
import { ReactComponent as PenIcon } from "../assets/icons/favourites/pen.svg";

import "./common.less";

type OV<V> = mobx.IObservableValue<V>;

function renderCmdText(text: string): any {
    return <span>&#x2318;{text}</span>;
}

class CmdStrCode extends React.Component<
    {
        cmdstr: string;
        onUse: () => void;
        onCopy: () => void;
        isCopied: boolean;
        fontSize: "normal" | "large";
        limitHeight: boolean;
    },
    {}
> {
    @boundMethod
    handleUse(e: any) {
        e.stopPropagation();
        if (this.props.onUse != null) {
            this.props.onUse();
        }
    }

    @boundMethod
    handleCopy(e: any) {
        e.stopPropagation();
        if (this.props.onCopy != null) {
            this.props.onCopy();
        }
    }

    render() {
        let { isCopied, cmdstr, fontSize, limitHeight } = this.props;
        return (
            <div className={cn("cmdstr-code", { "is-large": fontSize == "large" }, { "limit-height": limitHeight })}>
                <If condition={isCopied}>
                    <div key="copied" className="copied-indicator">
                        <div>copied</div>
                    </div>
                </If>
                <div key="use" className="use-button hoverEffect" title="Use Command" onClick={this.handleUse}>
                    <CheckIcon className="icon" />
                </div>
                <div key="code" className="code-div">
                    <code>{cmdstr}</code>
                </div>
                <div key="copy" className="copy-control hoverEffect">
                    <div className="inner-copy" onClick={this.handleCopy} title="copy">
                        <CopyIcon className="icon" />
                    </div>
                </div>
            </div>
        );
    }
}

class Toggle extends React.Component<{ checked: boolean; onChange: (value: boolean) => void }, {}> {
    @boundMethod
    handleChange(e: any): void {
        let { onChange } = this.props;
        if (onChange != null) {
            onChange(e.target.checked);
        }
    }

    render() {
        return (
            <label className="checkbox-toggle">
                <input type="checkbox" checked={this.props.checked} onChange={this.handleChange} />
                <span className="slider" />
            </label>
        );
    }
}

class Checkbox extends React.Component<
    { checked: boolean; onChange: (value: boolean) => void; label: string; id: string },
    {}
> {
    render() {
        const { checked, onChange, label, id } = this.props;

        return (
            <div className="checkbox">
                <input
                    type="checkbox"
                    id={id}
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    aria-checked={checked}
                    role="checkbox"
                />
                <label htmlFor={id}>
                    <span></span>
                    {label}
                </label>
            </div>
        );
    }
}

interface InputDecorationProps {
    children: React.ReactNode;
}

@mobxReact.observer
class InputDecoration extends React.Component<InputDecorationProps, {}> {
    render() {
        const { children, onClick } = this.props;

        return <div className="input-decoration">{children}</div>;
    }
}

interface TextFieldDecorationProps {
    startDecoration?: React.ReactNode;
    endDecoration?: React.ReactNode;
}
interface TextFieldProps {
    label: string;
    value?: string;
    className?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    defaultValue?: string;
    decoration?: TextFieldDecorationProps;
    required?: boolean;
}

interface TextFieldState {
    focused: boolean;
    internalValue: string;
    error: boolean;
    showHelpText: boolean;
    hasContent: boolean;
}

@mobxReact.observer
class TextField extends React.Component<TextFieldProps, TextFieldState> {
    inputRef: React.RefObject<HTMLInputElement>;
    state: TextFieldState;

    constructor(props: TextFieldProps) {
        super(props);
        const hasInitialContent = Boolean(props.value || props.defaultValue);
        this.state = {
            focused: false,
            hasContent: hasInitialContent,
            internalValue: props.defaultValue || "",
            error: false,
            showHelpText: false,
        };
        this.inputRef = React.createRef();
    }

    componentDidUpdate(prevProps: TextFieldProps) {
        // Only update the focus state if using as controlled
        if (this.props.value !== undefined && this.props.value !== prevProps.value) {
            this.setState({ focused: Boolean(this.props.value) });
        }
    }

    @boundMethod
    handleFocus() {
        this.setState({ focused: true });
    }

    @boundMethod
    handleBlur() {
        const { required } = this.props;
        if (this.inputRef.current) {
            const value = this.inputRef.current.value;
            if (required && !value) {
                this.setState({ error: true, focused: false });
            } else {
                this.setState({ error: false, focused: false });
            }
        }
    }

    @boundMethod
    handleHelpTextClick() {
        this.setState((prevState) => ({ showHelpText: !prevState.showHelpText }));
    }

    debouncedOnChange = debounce(300, (value) => {
        const { onChange } = this.props;
        onChange?.(value);
    });

    @boundMethod
    handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        const { required } = this.props;
        const inputValue = e.target.value;

        // Check if value is empty and the field is required
        if (required && !inputValue) {
            this.setState({ error: true, hasContent: false });
        } else {
            this.setState({ error: false, hasContent: Boolean(inputValue) });
        }

        // Update the internal state for uncontrolled version
        if (this.props.value === undefined) {
            this.setState({ internalValue: inputValue });
        }

        this.debouncedOnChange(inputValue);
    }

    render() {
        const { label, value, placeholder, decoration, className } = this.props;
        const { focused, internalValue, error } = this.state;

        // Decide if the input should behave as controlled or uncontrolled
        const inputValue = value !== undefined ? value : internalValue;

        return (
            <div className={cn(`textfield ${className || ""}`, { focused: focused, error: error })}>
                {decoration?.startDecoration && <>{decoration.startDecoration}</>}
                <div className="textfield-inner">
                    <label
                        className={cn("textfield-label", {
                            float: this.state.hasContent || this.state.focused || placeholder,
                            start: decoration?.startDecoration,
                        })}
                        htmlFor={label}
                    >
                        {label}
                    </label>
                    <input
                        className={cn("textfield-input", { start: decoration?.startDecoration })}
                        ref={this.inputRef}
                        id={label}
                        value={inputValue}
                        onChange={this.handleInputChange}
                        onFocus={this.handleFocus}
                        onBlur={this.handleBlur}
                        placeholder={placeholder}
                    />
                </div>
                {decoration?.endDecoration && <div>{decoration.endDecoration}</div>}
            </div>
        );
    }
}

@mobxReact.observer
class RemoteStatusLight extends React.Component<{ remote: RemoteType }, {}> {
    render() {
        let remote = this.props.remote;
        let status = "error";
        let wfp = false;
        if (remote != null) {
            status = remote.status;
            wfp = remote.waitingforpassword;
        }
        if (status == "connecting") {
            if (wfp) return <KeyIcon className={`remote-status status-${status}`} />;
            else return <RotateIcon className={`remote-status status-${status}`} />;
        }
        return <CircleIcon className={`remote-status status-${status}`} />;
    }
}

@mobxReact.observer
class InlineSettingsTextEdit extends React.Component<
    {
        text: string;
        value: string;
        onChange: (val: string) => void;
        maxLength: number;
        placeholder: string;
        showIcon?: boolean;
    },
    {}
> {
    isEditing: OV<boolean> = mobx.observable.box(false, { name: "inlineedit-isEditing" });
    tempText: OV<string>;
    shouldFocus: boolean = false;
    inputRef: React.RefObject<any> = React.createRef();

    componentDidUpdate(): void {
        if (this.shouldFocus) {
            this.shouldFocus = false;
            if (this.inputRef.current != null) {
                this.inputRef.current.focus();
            }
        }
    }

    @boundMethod
    handleChangeText(e: any): void {
        mobx.action(() => {
            this.tempText.set(e.target.value);
        })();
    }

    @boundMethod
    confirmChange(): void {
        mobx.action(() => {
            let newText = this.tempText.get();
            this.isEditing.set(false);
            this.tempText = null;
            this.props.onChange(newText);
        })();
    }

    @boundMethod
    cancelChange(): void {
        mobx.action(() => {
            this.isEditing.set(false);
            this.tempText = null;
        })();
    }

    @boundMethod
    handleKeyDown(e: any): void {
        if (e.code == "Enter") {
            e.preventDefault();
            e.stopPropagation();
            this.confirmChange();
            return;
        }
        if (e.code == "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this.cancelChange();
            return;
        }
        return;
    }

    @boundMethod
    clickEdit(): void {
        mobx.action(() => {
            this.isEditing.set(true);
            this.shouldFocus = true;
            this.tempText = mobx.observable.box(this.props.value, { name: "inlineedit-tempText" });
        })();
    }

    render() {
        if (this.isEditing.get()) {
            return (
                <div className={cn("settings-input inline-edit", "edit-active")}>
                    <div className="field has-addons">
                        <div className="control">
                            <input
                                ref={this.inputRef}
                                className="input"
                                type="text"
                                onKeyDown={this.handleKeyDown}
                                placeholder={this.props.placeholder}
                                onChange={this.handleChangeText}
                                value={this.tempText.get()}
                                maxLength={this.props.maxLength}
                            />
                        </div>
                        <div className="control">
                            <div
                                onClick={this.cancelChange}
                                title="Cancel (Esc)"
                                className="button is-prompt-danger is-outlined is-small"
                            >
                                <XMarkIcon className="icon" />
                            </div>
                        </div>
                        <div className="control">
                            <div
                                onClick={this.confirmChange}
                                title="Confirm (Enter)"
                                className="button is-prompt-green is-outlined is-small"
                            >
                                <CheckIcon className="icon" />
                            </div>
                        </div>
                    </div>
                </div>
            );
        } else {
            return (
                <div onClick={this.clickEdit} className={cn("settings-input inline-edit", "edit-not-active")}>
                    {this.props.text}
                    <If condition={this.props.showIcon}>
                        <PenIcon className="icon" />
                    </If>
                </div>
            );
        }
    }
}

@mobxReact.observer
class InfoMessage extends React.Component<{ width: number; children: React.ReactNode }> {
    render() {
        return (
            <div className="info-message">
                <div className="message-icon">
                    <CircleInfoIcon className="icon" />
                </div>
                <div className="message-content" style={{ width: this.props.width }}>
                    <div className="info-icon">
                        <CircleInfoIcon className="icon" />
                    </div>
                    <div className="info-children">{this.props.children}</div>
                </div>
            </div>
        );
    }
}

function LinkRenderer(props: any): any {
    let newUrl = "https://extern?" + encodeURIComponent(props.href);
    return (
        <a href={newUrl} target="_blank">
            {props.children}
        </a>
    );
}

function HeaderRenderer(props: any, hnum: number): any {
    return <div className={cn("title", "is-" + hnum)}>{props.children}</div>;
}

function CodeRenderer(props: any): any {
    return <code className={cn({ inline: props.inline })}>{props.children}</code>;
}

@mobxReact.observer
class Markdown extends React.Component<{ text: string; style?: any; extraClassName?: string }, {}> {
    render() {
        let text = this.props.text;
        let markdownComponents = {
            a: LinkRenderer,
            h1: (props) => HeaderRenderer(props, 1),
            h2: (props) => HeaderRenderer(props, 2),
            h3: (props) => HeaderRenderer(props, 3),
            h4: (props) => HeaderRenderer(props, 4),
            h5: (props) => HeaderRenderer(props, 5),
            h6: (props) => HeaderRenderer(props, 6),
            code: CodeRenderer,
        };
        return (
            <div className={cn("markdown content", this.props.extraClassName)} style={this.props.style}>
                <ReactMarkdown children={text} remarkPlugins={[remarkGfm]} components={markdownComponents} />
            </div>
        );
    }
}

@mobxReact.observer
class SettingsError extends React.Component<{ errorMessage: OV<string> }, {}> {
    @boundMethod
    dismissError(): void {
        mobx.action(() => {
            this.props.errorMessage.set(null);
        })();
    }

    render() {
        if (this.props.errorMessage.get() == null) {
            return null;
        }
        return (
            <div className="settings-field settings-error">
                <div>Error: {this.props.errorMessage.get()}</div>
                <div className="flex-spacer" />
                <div onClick={this.dismissError} className="error-dismiss">
                    <i className="fa-sharp fa-solid fa-xmark" />
                </div>
            </div>
        );
    }
}

export {
    CmdStrCode,
    Toggle,
    Checkbox,
    renderCmdText,
    RemoteStatusLight,
    InlineSettingsTextEdit,
    InfoMessage,
    Markdown,
    SettingsError,
    TextField,
    InputDecoration,
};
