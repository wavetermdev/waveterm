import { Input } from "@/app/element/input";
import { InputDecoration } from "@/app/element/inputdecoration";
import { useDimensions } from "@/app/hook/useDimensions";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import React, { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";

import "./typeaheadmodal.less";

type ConnStatus = "connected" | "connecting" | "disconnected" | "error";

interface BaseItem {
    label: string;
    icon?: string | React.ReactNode;
}

interface FileItem extends BaseItem {
    value: string;
}

interface ConnectionItem extends BaseItem {
    status: ConnStatus;
    iconColor: string;
}

interface ConnectionScope {
    headerText?: string;
    items: ConnectionItem[];
}

type SuggestionsType = FileItem | ConnectionItem | ConnectionScope;

interface SuggestionsProps {
    suggestions?: SuggestionsType[];
    onSelect?: (_: string) => void;
}

const Suggestions = forwardRef<HTMLDivElement, SuggestionsProps>(({ suggestions, onSelect }: SuggestionsProps, ref) => {
    const renderIcon = (icon: string | React.ReactNode) => {
        if (typeof icon === "string") {
            return <i className={makeIconClass(icon, false)}></i>;
        }
        return icon;
    };

    const renderItem = (item: BaseItem | ConnectionItem, index: number) => (
        <div key={index} onClick={() => onSelect(item.label)} className="suggestion-item">
            <div className="name">
                {item.icon && renderIcon(item.icon)}
                {item.label}
            </div>
            {"status" in item && item.status == "connected" && <i className={makeIconClass("fa-check", false)}></i>}
        </div>
    );

    return (
        <div ref={ref} className="suggestions">
            {suggestions.map((item, index) => {
                if ("headerText" in item) {
                    return (
                        <div key={index}>
                            {item.headerText && <div className="suggestion-header">{item.headerText}</div>}
                            {item.items.map((subItem, subIndex) => renderItem(subItem, subIndex))}
                        </div>
                    );
                }
                return renderItem(item as BaseItem, index);
            })}
        </div>
    );
});

interface TypeAheadModalProps {
    anchorRef: React.RefObject<HTMLDivElement>;
    blockRef?: React.RefObject<HTMLDivElement>;
    suggestions?: SuggestionsType[];
    label?: string;
    className?: string;
    value?: string;
    onChange?: (_: string) => void;
    onSelect?: (_: string) => void;
    onClickBackdrop?: () => void;
    onKeyDown?: (_) => void;
    giveFocusRef?: React.MutableRefObject<() => boolean>;
    autoFocus?: boolean;
}

const TypeAheadModal = ({
    className,
    suggestions,
    label,
    anchorRef,
    blockRef,
    value,
    onChange,
    onSelect,
    onKeyDown,
    onClickBackdrop,
    giveFocusRef,
    autoFocus,
}: TypeAheadModalProps) => {
    const { width, height } = useDimensions(blockRef);
    const modalRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLDivElement>(null);
    const realInputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const [suggestionsHeight, setSuggestionsHeight] = useState<number | undefined>(undefined);
    const [modalHeight, setModalHeight] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (modalRef.current && inputRef.current && suggestionsRef.current) {
            const modalPadding = 32;
            const inputHeight = inputRef.current.getBoundingClientRect().height;
            let suggestionsTotalHeight = 0;

            const suggestionItems = suggestionsRef.current.children;
            for (let i = 0; i < suggestionItems.length; i++) {
                suggestionsTotalHeight += suggestionItems[i].getBoundingClientRect().height;
            }

            const totalHeight = modalPadding + inputHeight + suggestionsTotalHeight;
            const maxHeight = height * 0.8;
            const computedHeight = totalHeight > maxHeight ? maxHeight : totalHeight;

            setModalHeight(`${computedHeight}px`);

            const padding = 16 * 2;
            setSuggestionsHeight(computedHeight - inputHeight - padding);
        }
    }, [height, suggestions]);

    useLayoutEffect(() => {
        if (giveFocusRef) {
            giveFocusRef.current = () => {
                realInputRef.current?.focus();
                return true;
            };
        }
        return () => {
            if (giveFocusRef) {
                giveFocusRef.current = null;
            }
        };
    }, [giveFocusRef]);

    const renderBackdrop = (onClick) => <div className="type-ahead-modal-backdrop" onClick={onClick}></div>;

    const handleKeyDown = (e) => {
        onKeyDown && onKeyDown(e);
    };

    const handleChange = (value) => {
        onChange && onChange(value);
    };

    const handleSelect = (value) => {
        onSelect && onSelect(value);
    };

    let modalWidth = 300;
    if (modalWidth < 300) {
        modalWidth = Math.min(300, width * 0.95);
    }

    const anchorRect = anchorRef.current.getBoundingClientRect();
    const blockRect = blockRef.current.getBoundingClientRect();

    // Calculate positions relative to the wrapper
    const topPosition = 30; // Adjusting the modal to be just below the anchor
    const leftPosition = anchorRect.left - blockRect.left; // Relative left position to the wrapper div

    const renderModal = () => (
        <div className="type-ahead-modal-wrapper" onKeyDown={handleKeyDown}>
            {renderBackdrop(onClickBackdrop)}
            <div
                ref={modalRef}
                className={clsx("type-ahead-modal", className)}
                style={{
                    top: topPosition,
                    left: leftPosition,
                    width: modalWidth,
                    maxHeight: modalHeight,
                }}
            >
                <div className={clsx("content-wrapper", { "has-suggestions": suggestions?.length })}>
                    <Input
                        ref={inputRef}
                        inputRef={realInputRef}
                        onChange={handleChange}
                        value={value}
                        autoFocus={autoFocus}
                        placeholder={label}
                        decoration={{
                            endDecoration: (
                                <InputDecoration>
                                    <i className="fa-regular fa-magnifying-glass"></i>
                                </InputDecoration>
                            ),
                        }}
                    />
                    <div
                        className="suggestions-wrapper"
                        style={{
                            marginTop: suggestions?.length > 0 ? "8px" : "0",
                            height: suggestionsHeight,
                            overflowY: "auto",
                        }}
                    >
                        {suggestions && (
                            <Suggestions ref={suggestionsRef} suggestions={suggestions} onSelect={handleSelect} />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    if (blockRef && blockRef.current == null) {
        return null;
    }

    return ReactDOM.createPortal(renderModal(), blockRef.current);
};

export { TypeAheadModal };
export type { SuggestionsType };
