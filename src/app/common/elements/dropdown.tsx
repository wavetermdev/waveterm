// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { If } from "tsx-control-statements/components";
import ReactDOM from "react-dom";

import "./dropdown.less";

interface DropdownDecorationProps {
    startDecoration?: React.ReactNode;
    endDecoration?: React.ReactNode;
}

interface DropdownProps {
    label?: string;
    options: DropdownItem[];
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

export { Dropdown };
