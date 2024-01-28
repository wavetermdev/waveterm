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
import { RemoteType, ResizablePaneNameType } from "../../types/types";
import ReactDOM from "react-dom";
import { GlobalModel, GlobalCommandRunner, ResizablePaneModel } from "../../model/model";
import * as appconst from "../appconst";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent } from "../../util/keyutil";
import { MagicLayout } from "../magiclayout";

import { ReactComponent as CheckIcon } from "../assets/icons/line/check.svg";
import { ReactComponent as CopyIcon } from "../assets/icons/history/copy.svg";
import { ReactComponent as CircleIcon } from "../assets/icons/circle.svg";
import { ReactComponent as KeyIcon } from "../assets/icons/key.svg";
import { ReactComponent as RotateIcon } from "../assets/icons/rotate_left.svg";
import { ReactComponent as CircleInfoIcon } from "../assets/icons/circle_info.svg";

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
    {
        checked?: boolean;
        defaultChecked?: boolean;
        onChange: (value: boolean) => void;
        label: React.ReactNode;
        className?: string;
        id?: string;
    },
    { checkedInternal: boolean }
> {
    generatedId;
    static idCounter = 0;

    constructor(props) {
        super(props);
        this.state = {
            checkedInternal: this.props.checked ?? Boolean(this.props.defaultChecked),
        };
        this.generatedId = `checkbox-${Checkbox.idCounter++}`;
    }

    componentDidUpdate(prevProps) {
        if (this.props.checked !== undefined && this.props.checked !== prevProps.checked) {
            this.setState({ checkedInternal: this.props.checked });
        }
    }

    handleChange = (e) => {
        const newChecked = e.target.checked;
        if (this.props.checked === undefined) {
            this.setState({ checkedInternal: newChecked });
        }
        this.props.onChange(newChecked);
    };

    render() {
        const { label, className, id } = this.props;
        const { checkedInternal } = this.state;
        const checkboxId = id || this.generatedId;

        return (
            <div className={cn("checkbox", className)}>
                <input
                    type="checkbox"
                    id={checkboxId}
                    checked={checkedInternal}
                    onChange={this.handleChange}
                    aria-checked={checkedInternal}
                    role="checkbox"
                />
                <label htmlFor={checkboxId}>
                    <span></span>
                    {label}
                </label>
            </div>
        );
    }
}

interface InputDecorationProps {
    position?: "start" | "end";
    children: React.ReactNode;
}

@mobxReact.observer
class InputDecoration extends React.Component<InputDecorationProps, {}> {
    render() {
        const { children, position = "end" } = this.props;
        return (
            <div
                className={cn("wave-input-decoration", {
                    "start-position": position === "start",
                    "end-position": position === "end",
                })}
            >
                {children}
            </div>
        );
    }
}

interface TooltipProps {
    message: React.ReactNode;
    icon?: React.ReactNode; // Optional icon property
    children: React.ReactNode;
    className?: string;
}

interface TooltipState {
    isVisible: boolean;
}

@mobxReact.observer
class Tooltip extends React.Component<TooltipProps, TooltipState> {
    iconRef: React.RefObject<HTMLDivElement>;

    constructor(props: TooltipProps) {
        super(props);
        this.state = {
            isVisible: false,
        };
        this.iconRef = React.createRef();
    }

    @boundMethod
    showBubble() {
        this.setState({ isVisible: true });
    }

    @boundMethod
    hideBubble() {
        this.setState({ isVisible: false });
    }

    @boundMethod
    calculatePosition() {
        // Get the position of the icon element
        const iconElement = this.iconRef.current;
        if (iconElement) {
            const rect = iconElement.getBoundingClientRect();
            return {
                top: `${rect.bottom + window.scrollY - 29}px`,
                left: `${rect.left + window.scrollX + rect.width / 2 - 17.5}px`,
            };
        }
        return {};
    }

    @boundMethod
    renderBubble() {
        if (!this.state.isVisible) return null;

        const style = this.calculatePosition();

        return ReactDOM.createPortal(
            <div className={cn("wave-tooltip", this.props.className)} style={style}>
                {this.props.icon && <div className="wave-tooltip-icon">{this.props.icon}</div>}
                <div className="wave-tooltip-message">{this.props.message}</div>
            </div>,
            document.getElementById("app")!
        );
    }

    render() {
        return (
            <div onMouseEnter={this.showBubble} onMouseLeave={this.hideBubble} ref={this.iconRef}>
                {this.props.children}
                {this.renderBubble()}
            </div>
        );
    }
}

type ButtonVariantType = "outlined" | "solid" | "ghost";
type ButtonThemeType = "primary" | "secondary";

interface ButtonProps {
    theme?: ButtonThemeType;
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: ButtonVariantType;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    color?: string;
    style?: React.CSSProperties;
    autoFocus?: boolean;
    className?: string;
}

class Button extends React.Component<ButtonProps> {
    static defaultProps = {
        theme: "primary",
        variant: "solid",
        color: "",
        style: {},
    };

    @boundMethod
    handleClick() {
        if (this.props.onClick && !this.props.disabled) {
            this.props.onClick();
        }
    }

    render() {
        const { leftIcon, rightIcon, theme, children, disabled, variant, color, style, autoFocus, className } =
            this.props;

        return (
            <button
                className={cn("wave-button", theme, variant, color, { disabled: disabled }, className)}
                onClick={this.handleClick}
                disabled={disabled}
                style={style}
                autoFocus={autoFocus}
            >
                {leftIcon && <span className="icon-left">{leftIcon}</span>}
                {children}
                {rightIcon && <span className="icon-right">{rightIcon}</span>}
            </button>
        );
    }
}

class IconButton extends Button {
    render() {
        const { children, theme, variant = "solid", ...rest } = this.props;
        const className = `wave-button icon-button ${theme} ${variant}`;

        return (
            <button {...rest} className={className}>
                {children}
            </button>
        );
    }
}

export default IconButton;

interface LinkButtonProps extends ButtonProps {
    href: string;
    rel?: string;
    target?: string;
}

class LinkButton extends React.Component<LinkButtonProps> {
    render() {
        const { leftIcon, rightIcon, children, className, ...rest } = this.props;

        return (
            <a {...rest} className={cn(`wave-button link-button`, className)}>
                {leftIcon && <span className="icon-left">{leftIcon}</span>}
                {children}
                {rightIcon && <span className="icon-right">{rightIcon}</span>}
            </a>
        );
    }
}

interface StatusProps {
    status: "green" | "red" | "gray" | "yellow";
    text: string;
}

class Status extends React.Component<StatusProps> {
    @boundMethod
    renderDot() {
        const { status } = this.props;

        return <div className={`dot ${status}`} />;
    }

    render() {
        const { text } = this.props;

        return (
            <div className="wave-status-container">
                {this.renderDot()}
                <span>{text}</span>
            </div>
        );
    }
}

interface TextFieldDecorationProps {
    startDecoration?: React.ReactNode;
    endDecoration?: React.ReactNode;
}
interface TextFieldProps {
    label?: string;
    value?: string;
    className?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    defaultValue?: string;
    decoration?: TextFieldDecorationProps;
    required?: boolean;
    maxLength?: number;
    autoFocus?: boolean;
    disabled?: boolean;
}

interface TextFieldState {
    focused: boolean;
    internalValue: string;
    error: boolean;
    showHelpText: boolean;
    hasContent: boolean;
}

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

    // Method to handle focus at the component level
    @boundMethod
    handleComponentFocus() {
        if (this.inputRef.current && !this.inputRef.current.contains(document.activeElement)) {
            this.inputRef.current.focus();
        }
    }

    // Method to handle blur at the component level
    @boundMethod
    handleComponentBlur() {
        if (this.inputRef.current?.contains(document.activeElement)) {
            this.inputRef.current.blur();
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

    @boundMethod
    handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        const { required, onChange } = this.props;
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

        onChange && onChange(inputValue);
    }

    render() {
        const { label, value, placeholder, decoration, className, maxLength, autoFocus, disabled } = this.props;
        const { focused, internalValue, error } = this.state;

        // Decide if the input should behave as controlled or uncontrolled
        const inputValue = value ?? internalValue;

        return (
            <div
                className={cn("wave-textfield", className, {
                    focused: focused,
                    error: error,
                    disabled: disabled,
                    "no-label": !label,
                })}
                onFocus={this.handleComponentFocus}
                onBlur={this.handleComponentBlur}
                tabIndex={-1}
            >
                {decoration?.startDecoration && <>{decoration.startDecoration}</>}
                <div className="wave-textfield-inner">
                    <If condition={label}>
                        <label
                            className={cn("wave-textfield-inner-label", {
                                float: this.state.hasContent || this.state.focused || placeholder,
                                "offset-left": decoration?.startDecoration,
                            })}
                            htmlFor={label}
                        >
                            {label}
                        </label>
                    </If>
                    <input
                        className={cn("wave-textfield-inner-input", { "offset-left": decoration?.startDecoration })}
                        ref={this.inputRef}
                        id={label}
                        value={inputValue}
                        onChange={this.handleInputChange}
                        onFocus={this.handleFocus}
                        onBlur={this.handleBlur}
                        placeholder={placeholder}
                        maxLength={maxLength}
                        autoFocus={autoFocus}
                        disabled={disabled}
                    />
                </div>
                {decoration?.endDecoration && <>{decoration.endDecoration}</>}
            </div>
        );
    }
}

class NumberField extends TextField {
    @boundMethod
    handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        const { required, onChange } = this.props;
        const inputValue = e.target.value;

        // Allow only numeric input
        if (inputValue === "" || /^\d*$/.test(inputValue)) {
            // Update the internal state only if the component is not controlled.
            if (this.props.value === undefined) {
                const isError = required ? inputValue.trim() === "" : false;

                this.setState({
                    internalValue: inputValue,
                    error: isError,
                    hasContent: Boolean(inputValue),
                });
            }

            onChange && onChange(inputValue);
        }
    }

    render() {
        // Use the render method from TextField but add the onKeyDown handler
        const renderedTextField = super.render();
        return React.cloneElement(renderedTextField);
    }
}

interface PasswordFieldState extends TextFieldState {
    passwordVisible: boolean;
}

@mobxReact.observer
class PasswordField extends TextField {
    state: PasswordFieldState;

    constructor(props) {
        super(props);
        this.state = {
            ...this.state,
            passwordVisible: false,
        };
    }

    @boundMethod
    togglePasswordVisibility() {
        //@ts-ignore
        this.setState((prevState) => ({
            //@ts-ignore
            passwordVisible: !prevState.passwordVisible,
        }));
    }

    @boundMethod
    handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        // Call the parent handleInputChange method
        super.handleInputChange(e);
    }

    render() {
        const { decoration, className, placeholder, maxLength, label } = this.props;
        const { focused, internalValue, error, passwordVisible } = this.state;
        const inputValue = this.props.value ?? internalValue;

        // The input should always receive the real value
        const inputProps = {
            className: cn("wave-textfield-inner-input", { "offset-left": decoration?.startDecoration }),
            ref: this.inputRef,
            id: label,
            value: inputValue, // Always use the real value here
            onChange: this.handleInputChange,
            onFocus: this.handleFocus,
            onBlur: this.handleBlur,
            placeholder: placeholder,
            maxLength: maxLength,
        };

        return (
            <div className={cn(`wave-textfield wave-password ${className || ""}`, { focused: focused, error: error })}>
                {decoration?.startDecoration && <>{decoration.startDecoration}</>}
                <div className="wave-textfield-inner">
                    <label
                        className={cn("wave-textfield-inner-label", {
                            float: this.state.hasContent || this.state.focused || placeholder,
                            "offset-left": decoration?.startDecoration,
                        })}
                        htmlFor={label}
                    >
                        {label}
                    </label>
                    <If condition={passwordVisible}>
                        <input {...inputProps} type="text" />
                    </If>
                    <If condition={!passwordVisible}>
                        <input {...inputProps} type="password" />
                    </If>
                    <div
                        className="wave-textfield-inner-eye"
                        onClick={this.togglePasswordVisibility}
                        style={{ cursor: "pointer" }}
                    >
                        <If condition={passwordVisible}>
                            <i className="fa-sharp fa-solid fa-eye"></i>
                        </If>
                        <If condition={!passwordVisible}>
                            <i className="fa-sharp fa-solid fa-eye-slash"></i>
                        </If>
                    </div>
                </div>
                {decoration?.endDecoration && <>{decoration.endDecoration}</>}
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
        let waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (checkKeyPressed(waveEvent, "Enter")) {
            e.preventDefault();
            e.stopPropagation();
            this.confirmChange();
            return;
        }
        if (checkKeyPressed(waveEvent, "Escape")) {
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
                                <span className="icon is-small">
                                    <i className="fa-sharp fa-solid fa-xmark" />
                                </span>
                            </div>
                        </div>
                        <div className="control">
                            <div
                                onClick={this.confirmChange}
                                title="Confirm (Enter)"
                                className="button is-wave-green is-outlined is-small"
                            >
                                <span className="icon is-small">
                                    <i className="fa-sharp fa-solid fa-check" />
                                </span>
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
                        <i className="fa-sharp fa-solid fa-pen" />
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
        <a href={newUrl} target="_blank" rel={"noopener"}>
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
class CodeBlockMarkdown extends React.Component<{ children: React.ReactNode; codeSelectSelectedIndex?: number }, {}> {
    blockIndex: number;
    blockRef: React.RefObject<HTMLPreElement>;

    constructor(props) {
        super(props);
        this.blockRef = React.createRef();
        this.blockIndex = GlobalModel.inputModel.addCodeBlockToCodeSelect(this.blockRef);
    }

    render() {
        let clickHandler: (e: React.MouseEvent<HTMLElement>, blockIndex: number) => void;
        let inputModel = GlobalModel.inputModel;
        clickHandler = (e: React.MouseEvent<HTMLElement>, blockIndex: number) => {
            inputModel.setCodeSelectSelectedCodeBlock(blockIndex);
        };
        let selected = this.blockIndex == this.props.codeSelectSelectedIndex;
        return (
            <pre
                ref={this.blockRef}
                className={cn({ selected: selected })}
                onClick={(event) => clickHandler(event, this.blockIndex)}
            >
                {this.props.children}
            </pre>
        );
    }
}

@mobxReact.observer
class Markdown extends React.Component<
    { text: string; style?: any; extraClassName?: string; codeSelect?: boolean },
    {}
> {
    CodeBlockRenderer(props: any, codeSelect: boolean, codeSelectIndex: number): any {
        if (codeSelect) {
            return <CodeBlockMarkdown codeSelectSelectedIndex={codeSelectIndex}>{props.children}</CodeBlockMarkdown>;
        } else {
            const clickHandler = (e: React.MouseEvent<HTMLElement>) => {
                let blockText = (e.target as HTMLElement).innerText;
                if (blockText) {
                    blockText = blockText.replace(/\n$/, ""); // remove trailing newline
                    navigator.clipboard.writeText(blockText);
                }
            };
            return <pre onClick={(event) => clickHandler(event)}>{props.children}</pre>;
        }
    }

    render() {
        let text = this.props.text;
        let codeSelect = this.props.codeSelect;
        let curCodeSelectIndex = GlobalModel.inputModel.getCodeSelectSelectedIndex();
        let markdownComponents = {
            a: LinkRenderer,
            h1: (props) => HeaderRenderer(props, 1),
            h2: (props) => HeaderRenderer(props, 2),
            h3: (props) => HeaderRenderer(props, 3),
            h4: (props) => HeaderRenderer(props, 4),
            h5: (props) => HeaderRenderer(props, 5),
            h6: (props) => HeaderRenderer(props, 6),
            code: (props) => CodeRenderer(props),
            pre: (props) => this.CodeBlockRenderer(props, codeSelect, curCodeSelectIndex),
        };
        return (
            <div className={cn("markdown content", this.props.extraClassName)} style={this.props.style}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {text}
                </ReactMarkdown>
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

interface DropdownDecorationProps {
    startDecoration?: React.ReactNode;
    endDecoration?: React.ReactNode;
}

interface DropdownProps {
    label?: string;
    options: { value: string; label: string }[];
    value?: string;
    className?: string;
    onChange: (value: string) => void;
    placeholder?: string;
    decoration?: DropdownDecorationProps;
    defaultValue?: string;
    required?: boolean;
}

interface DropdownState {
    isOpen: boolean;
    internalValue: string;
    highlightedIndex: number;
    isTouched: boolean;
}

@mobxReact.observer
class Dropdown extends React.Component<DropdownProps, DropdownState> {
    wrapperRef: React.RefObject<HTMLDivElement>;
    menuRef: React.RefObject<HTMLDivElement>;
    timeoutId: any;

    constructor(props: DropdownProps) {
        super(props);
        this.state = {
            isOpen: false,
            internalValue: props.defaultValue || "",
            highlightedIndex: -1,
            isTouched: false,
        };
        this.wrapperRef = React.createRef();
        this.menuRef = React.createRef();
    }

    componentDidMount() {
        document.addEventListener("mousedown", this.handleClickOutside);
    }

    componentWillUnmount() {
        document.removeEventListener("mousedown", this.handleClickOutside);
    }

    componentDidUpdate(prevProps: Readonly<DropdownProps>, prevState: Readonly<DropdownState>, snapshot?: any): void {
        // If the dropdown was open but now is closed, start the timeout
        if (prevState.isOpen && !this.state.isOpen) {
            this.timeoutId = setTimeout(() => {
                if (this.menuRef.current) {
                    this.menuRef.current.style.display = "none";
                }
            }, 300); // Time is equal to the animation duration
        }
        // If the dropdown is now open, cancel any existing timeout and show the menu
        else if (!prevState.isOpen && this.state.isOpen) {
            if (this.timeoutId !== null) {
                clearTimeout(this.timeoutId); // Cancel any existing timeout
                this.timeoutId = null;
            }
            if (this.menuRef.current) {
                this.menuRef.current.style.display = "inline-flex";
            }
        }
    }

    @boundMethod
    handleClickOutside(event: MouseEvent) {
        // Check if the click is outside both the wrapper and the menu
        if (
            this.wrapperRef.current &&
            !this.wrapperRef.current.contains(event.target as Node) &&
            this.menuRef.current &&
            !this.menuRef.current.contains(event.target as Node)
        ) {
            this.setState({ isOpen: false });
        }
    }

    @boundMethod
    handleClick() {
        this.toggleDropdown();
    }

    @boundMethod
    handleFocus() {
        this.setState({ isTouched: true });
    }

    @boundMethod
    handleKeyDown(event: React.KeyboardEvent) {
        const { options } = this.props;
        const { isOpen, highlightedIndex } = this.state;

        switch (event.key) {
            case "Enter":
            case " ":
                if (isOpen) {
                    const option = options[highlightedIndex];
                    if (option) {
                        this.handleSelect(option.value, undefined);
                    }
                } else {
                    this.toggleDropdown();
                }
                break;
            case "Escape":
                this.setState({ isOpen: false });
                break;
            case "ArrowUp":
                if (isOpen) {
                    this.setState((prevState) => ({
                        highlightedIndex:
                            prevState.highlightedIndex > 0 ? prevState.highlightedIndex - 1 : options.length - 1,
                    }));
                }
                break;
            case "ArrowDown":
                if (isOpen) {
                    this.setState((prevState) => ({
                        highlightedIndex:
                            prevState.highlightedIndex < options.length - 1 ? prevState.highlightedIndex + 1 : 0,
                    }));
                }
                break;
            case "Tab":
                this.setState({ isOpen: false });
                break;
        }
    }

    @boundMethod
    handleSelect(value: string, event?: React.MouseEvent | React.KeyboardEvent) {
        const { onChange } = this.props;
        if (event) {
            event.stopPropagation(); // This stops the event from bubbling up to the wrapper
        }

        if (!("value" in this.props)) {
            this.setState({ internalValue: value });
        }
        onChange(value);
        this.setState({ isOpen: false, isTouched: true });
    }

    @boundMethod
    toggleDropdown() {
        this.setState((prevState) => ({ isOpen: !prevState.isOpen, isTouched: true }));
    }

    @boundMethod
    calculatePosition(): React.CSSProperties {
        if (this.wrapperRef.current) {
            const rect = this.wrapperRef.current.getBoundingClientRect();
            return {
                position: "absolute",
                top: `${rect.bottom + window.scrollY}px`,
                left: `${rect.left + window.scrollX}px`,
                width: `${rect.width}px`,
            };
        }
        return {};
    }

    render() {
        const { label, options, value, placeholder, decoration, className, required } = this.props;
        const { isOpen, internalValue, highlightedIndex, isTouched } = this.state;

        const currentValue = value ?? internalValue;
        const selectedOptionLabel =
            options.find((option) => option.value === currentValue)?.label || placeholder || internalValue;

        // Determine if the dropdown should be marked as having an error
        const isError =
            required &&
            (value === undefined || value === "") &&
            (internalValue === undefined || internalValue === "") &&
            isTouched;

        // Determine if the label should float
        const shouldLabelFloat = !!value || !!internalValue || !!placeholder || isOpen;

        const dropdownMenu = isOpen
            ? ReactDOM.createPortal(
                  <div className={cn("wave-dropdown-menu")} ref={this.menuRef} style={this.calculatePosition()}>
                      {options.map((option, index) => (
                          <div
                              key={option.value}
                              className={cn("wave-dropdown-item unselectable", {
                                  "wave-dropdown-item-highlighted": index === highlightedIndex,
                              })}
                              onClick={(e) => this.handleSelect(option.value, e)}
                              onMouseEnter={() => this.setState({ highlightedIndex: index })}
                              onMouseLeave={() => this.setState({ highlightedIndex: -1 })}
                          >
                              {option.label}
                          </div>
                      ))}
                  </div>,
                  document.getElementById("app")!
              )
            : null;

        return (
            <div
                className={cn("wave-dropdown", className, {
                    "wave-dropdown-error": isError,
                    "no-label": !label,
                })}
                ref={this.wrapperRef}
                tabIndex={0}
                onKeyDown={this.handleKeyDown}
                onClick={this.handleClick}
                onFocus={this.handleFocus}
            >
                {decoration?.startDecoration && <>{decoration.startDecoration}</>}
                <If condition={label}>
                    <div
                        className={cn("wave-dropdown-label unselectable", {
                            float: shouldLabelFloat,
                            "offset-left": decoration?.startDecoration,
                        })}
                    >
                        {label}
                    </div>
                </If>
                <div
                    className={cn("wave-dropdown-display unselectable", { "offset-left": decoration?.startDecoration })}
                >
                    {selectedOptionLabel}
                </div>
                <div className={cn("wave-dropdown-arrow", { "wave-dropdown-arrow-rotate": isOpen })}>
                    <i className="fa-sharp fa-solid fa-chevron-down"></i>
                </div>
                {dropdownMenu}
                {decoration?.endDecoration && <>{decoration.endDecoration}</>}
            </div>
        );
    }
}

interface ModalHeaderProps {
    onClose?: () => void;
    title: string;
}

const ModalHeader: React.FC<ModalHeaderProps> = ({ onClose, title }) => (
    <div className="wave-modal-header">
        {<div className="wave-modal-title">{title}</div>}
        <If condition={onClose}>
            <IconButton theme="secondary" variant="ghost" onClick={onClose}>
                <i className="fa-sharp fa-solid fa-xmark"></i>
            </IconButton>
        </If>
    </div>
);

interface ModalFooterProps {
    onCancel?: () => void;
    onOk?: () => void;
    cancelLabel?: string;
    okLabel?: string;
}

const ModalFooter: React.FC<ModalFooterProps> = ({ onCancel, onOk, cancelLabel = "Cancel", okLabel = "Ok" }) => (
    <div className="wave-modal-footer">
        {onCancel && (
            <Button theme="secondary" onClick={onCancel}>
                {cancelLabel}
            </Button>
        )}
        {onOk && <Button onClick={onOk}>{okLabel}</Button>}
    </div>
);

interface ModalProps {
    className?: string;
    children?: React.ReactNode;
    onClickBackdrop?: () => void;
}

class Modal extends React.Component<ModalProps> {
    static Header = ModalHeader;
    static Footer = ModalFooter;

    renderBackdrop(onClick: (() => void) | undefined) {
        return <div className="wave-modal-backdrop" onClick={onClick}></div>;
    }

    renderModal() {
        const { className, children } = this.props;

        return (
            <div className="wave-modal-container">
                {this.renderBackdrop(this.props.onClickBackdrop)}
                <div className={`wave-modal ${className}`}>
                    <div className="wave-modal-content">{children}</div>
                </div>
            </div>
        );
    }

    render() {
        return ReactDOM.createPortal(this.renderModal(), document.getElementById("app"));
    }
}

function ShowWaveShellInstallPrompt(callbackFn: () => void) {
    let message: string = `
In order to use Wave's advanced features like unified history and persistent sessions, Wave installs a small, open-source helper program called WaveShell on your remote machine.  WaveShell does not open any external ports and only communicates with your *local* Wave terminal instance over ssh.  For more information please see [the docs](https://docs.waveterm.dev/reference/waveshell).        
        `;
    message = message.trim();
    let prtn = GlobalModel.showAlert({
        message: message,
        confirm: true,
        markdown: true,
        confirmflag: appconst.ConfirmKey_HideShellPrompt,
    });
    prtn.then((confirm) => {
        if (!confirm) {
            return;
        }
        if (callbackFn) {
            callbackFn();
        }
    });
}

interface ResizableSidebarProps {
    name: ResizablePaneNameType;
    parentRef: React.RefObject<HTMLElement>;
    width?: number;
    collapsed?: boolean;
    enableSnap?: boolean;
    snapThreshold?: number;
    position?: "left" | "right";
    className?: string;
    children?: React.ReactNode;
}

@mobxReact.observer
class ResizableSidebar extends React.Component<ResizableSidebarProps> {
    isDragging: OV<boolean>;
    snapThreshold: number;
    enableSnap: boolean;
    resizeStartWidth: number = 0;
    startX: number = 0;
    position: string;
    prevDelta: number = 0;
    prevDragDirection: string = null;
    sidebarModel: ResizablePaneModel;

    constructor(props: ResizableSidebarProps) {
        super(props);

        this.sidebarModel = new ResizablePaneModel({
            name: this.props.name,
            width: this.props.width,
            collapsed: this.props.collapsed,
        });

        mobx.action(() => {
            GlobalModel.resizablePaneModels.set(this.props.name, this.sidebarModel);
        })();

        this.position = props.position || "left";

        this.isDragging = mobx.observable.box(false, { name: "ResizableSidebar-isDragging" });
        this.enableSnap = props.enableSnap ? props.enableSnap : true;
        this.snapThreshold = props.snapThreshold ? props.snapThreshold : MagicLayout.MainSidebarSnapThreshold;
    }

    componentDidUpdate(prevProps: Readonly<ResizableSidebarProps>): void {
        if (prevProps.collapsed != this.props.collapsed) {
            mobx.action(() => {
                let width = this.props.width;
                let collapsed = this.props.collapsed;
                this.sidebarModel.tempWidth.set(this.resolveWidthFromDb(width, collapsed));
                this.sidebarModel.tempCollapsed.set(collapsed);
            })();
        }
    }

    // When collapsed is set via cli, width is not updated, it remains the same as before.
    // This function is used to update the width when collapsed is set via cli.
    @boundMethod
    resolveWidthFromDb(width: number, collapsed: boolean): number {
        let newWidth;
        let minWidth = MagicLayout.MainSidebarMinWidth;
        let defaultWidth = MagicLayout.MainSidebarDefaultWidth;

        // From collapsed to expanded
        if (collapsed == false) {
            if (minWidth == width) {
                newWidth = defaultWidth;
            } else {
                newWidth = width;
            }
        }
        // From expanded to collapsed
        else if (width > minWidth && collapsed == true) {
            newWidth = minWidth;
        }
        return newWidth;
    }

    @boundMethod
    startResizing(event: React.MouseEvent<HTMLDivElement>) {
        event.preventDefault();

        const { parentRef } = this.props;
        const parentRect = parentRef.current?.getBoundingClientRect();

        if (!parentRect) return;

        if (this.position === "right") {
            this.startX = parentRect.right - event.clientX;
        } else {
            this.startX = event.clientX - parentRect.left;
        }

        this.resizeStartWidth = this.sidebarModel.tempWidth.get();
        document.addEventListener("mousemove", this.onMouseMove);
        document.addEventListener("mouseup", this.stopResizing);

        document.body.style.cursor = "col-resize";
        mobx.action(() => {
            this.isDragging.set(true);
        })();
    }

    @boundMethod
    getWidth(newWidth: number): number {
        return Math.max(MagicLayout.MainSidebarMinWidth, Math.min(newWidth, MagicLayout.MainSidebarMaxWidth));
    }

    @boundMethod
    onMouseMove(event: MouseEvent) {
        event.preventDefault();

        const { parentRef, enableSnap } = this.props;
        const parentRect = parentRef.current?.getBoundingClientRect();

        if (!this.isDragging.get() || !parentRect) return;

        let delta, newWidth;

        if (this.position === "right") {
            delta = parentRect.right - event.clientX - this.startX;
        } else {
            delta = event.clientX - parentRect.left - this.startX;
        }

        newWidth = this.resizeStartWidth + delta;

        if (enableSnap) {
            const minWidth = MagicLayout.MainSidebarMinWidth;
            const snapPoint = minWidth + this.snapThreshold;
            const dragResistance = MagicLayout.MainSidebarDragResistance;
            let dragDirection;

            if (delta - this.prevDelta > 0) {
                dragDirection = "+";
            } else if (delta - this.prevDelta == 0) {
                if (this.prevDragDirection == "+") {
                    dragDirection = "+";
                } else {
                    dragDirection = "-";
                }
            } else {
                dragDirection = "-";
            }

            this.prevDelta = delta;
            this.prevDragDirection = dragDirection;

            if (newWidth - dragResistance > minWidth && newWidth < snapPoint && dragDirection == "+") {
                newWidth = snapPoint;
                mobx.action(() => {
                    this.sidebarModel.tempWidth.set(this.getWidth(newWidth));
                    this.sidebarModel.tempCollapsed.set(false);
                })();
            } else if (newWidth + dragResistance < snapPoint && dragDirection == "-") {
                newWidth = minWidth;
                mobx.action(() => {
                    this.sidebarModel.tempWidth.set(this.getWidth(newWidth));
                    this.sidebarModel.tempCollapsed.set(true);
                })();
            } else if (newWidth > snapPoint) {
                mobx.action(() => {
                    this.sidebarModel.tempWidth.set(this.getWidth(newWidth));
                    this.sidebarModel.tempCollapsed.set(false);
                })();
            }
        } else {
            mobx.action(() => {
                this.sidebarModel.tempWidth.set(this.getWidth(newWidth));
                if (newWidth == MagicLayout.MainSidebarMinWidth) {
                    this.sidebarModel.tempCollapsed.set(true);
                } else {
                    this.sidebarModel.tempCollapsed.set(false);
                }
            })();
        }
    }

    @boundMethod
    stopResizing() {
        // console.log("stopResizing:got here");
        mobx.action(() => {
            this.isDragging.set(false);
            GlobalCommandRunner.clientSetSidebar(
                this.sidebarModel.tempWidth.get(),
                this.sidebarModel.tempCollapsed.get()
            );
        })();

        document.removeEventListener("mousemove", this.onMouseMove);
        document.removeEventListener("mouseup", this.stopResizing);
        document.body.style.cursor = "";
    }

    render() {
        const { className, children } = this.props;
        // console.log("this.tempCollapsed.get", this.sidebarModel.tempCollapsed.get());

        return (
            <div
                className={cn("sidebar", className, { collapsed: this.sidebarModel.tempCollapsed.get() })}
                style={{ width: `${this.sidebarModel.tempWidth.get()}px` }}
            >
                <div className="sidebar-content">{children}</div>
                <div
                    className="sidebar-handle"
                    style={{
                        position: "absolute",
                        top: 0,
                        [this.position === "left" ? "right" : "left"]: 0,
                        bottom: 0,
                        width: "5px",
                        cursor: "col-resize",
                    }}
                    onMouseDown={this.startResizing}
                ></div>
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
    Dropdown,
    TextField,
    InputDecoration,
    NumberField,
    PasswordField,
    Tooltip,
    Button,
    IconButton,
    LinkButton,
    Status,
    Modal,
    ResizableSidebar,
    ShowWaveShellInstallPrompt,
};
