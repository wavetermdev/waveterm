// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { If } from "tsx-control-statements/components";
import { TextFieldState, TextField } from "./textfield";

import "./passwordfield.less";

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
            <div
                className={cn(`wave-textfield wave-password ${className || ""}`, {
                    focused: focused,
                    error: error,
                    "no-label": !label,
                })}
            >
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

export { PasswordField };
