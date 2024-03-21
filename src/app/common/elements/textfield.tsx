// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { If } from "tsx-control-statements/components";

import "./textfield.less";

interface TextFieldDecorationProps {
    startDecoration?: React.ReactNode;
    endDecoration?: React.ReactNode;
}
interface TextFieldProps {
    label?: string;
    value?: string;
    className?: string;
    onChange?: (value: string) => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
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
                        className={cn("wave-textfield-inner-input", "wave-input", {
                            "offset-left": decoration?.startDecoration,
                        })}
                        ref={this.inputRef}
                        id={label}
                        value={inputValue}
                        onChange={this.handleInputChange}
                        onFocus={this.handleFocus}
                        onBlur={this.handleBlur}
                        onKeyDown={this.props.onKeyDown}
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

export { TextField };
export type { TextFieldProps, TextFieldDecorationProps, TextFieldState };
