// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobx from "mobx";
import cn from "classnames";

import "./checkbox.less";

class Checkbox extends React.PureComponent<
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

export { Checkbox };
