import { Input } from "@/app/element/input";
import { InputDecoration } from "@/app/element/inputdecoration";
import { useDimensions } from "@/app/hook/useDimensions";
import clsx from "clsx";
import React, { forwardRef, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";

import "./typeaheadmodal.less";

const dummy: SuggestionType[] = [
    {
        label: "Apple",
        value: "apple",
    },
    {
        label: "Banana",
        value: "banana",
    },
    {
        label: "Cherry",
        value: "cherry",
    },
    {
        label: "Date",
        value: "date",
    },
    {
        label: "Elderberry",
        value: "elderberry",
    },
    {
        label: "Apple",
        value: "apple",
    },
    {
        label: "Banana",
        value: "banana",
    },
    {
        label: "Cherry",
        value: "cherry",
    },
    {
        label: "Date",
        value: "date",
    },
    {
        label: "Elderberry",
        value: "elderberry",
    },
    {
        label: "Apple",
        value: "apple",
    },
    {
        label: "Banana",
        value: "banana",
    },
    {
        label: "Cherry",
        value: "cherry",
    },
    {
        label: "Date",
        value: "date",
    },
    {
        label: "Elderberry",
        value: "elderberry",
    },
];

type SuggestionType = {
    label: string;
    value: string;
    icon?: string;
};

interface SuggestionsProps {
    suggestions?: SuggestionType[];
    onSelect?: (_: string) => void;
}

const Suggestions = forwardRef<HTMLDivElement, SuggestionsProps>(({ suggestions, onSelect }: SuggestionsProps, ref) => {
    return (
        <div ref={ref} className="suggestions-wrapper" style={{ marginTop: suggestions?.length > 0 ? "8px" : "0" }}>
            {suggestions?.map((suggestion, index) => (
                <div className="suggestion" key={index} onClick={() => onSelect(suggestion.value)}>
                    {suggestion.label}
                </div>
            ))}
        </div>
    );
});

interface TypeAheadModalProps {
    anchor: React.MutableRefObject<HTMLDivElement>;
    suggestions?: SuggestionType[];
    label?: string;
    className?: string;
    value?: string;
    onChange?: (_: string) => void;
    onSelect?: (_: string) => void;
    onClickBackdrop?: () => void;
    onKeyDown?: (_) => void;
}

const TypeAheadModal = ({
    className,
    suggestions = dummy,
    label,
    anchor,
    value,
    onChange,
    onSelect,
    onClickBackdrop,
    onKeyDown,
}: TypeAheadModalProps) => {
    const { width, height } = useDimensions(anchor);
    const modalRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLDivElement>(null);
    const suggestionsWrapperRef = useRef<HTMLDivElement>(null);
    const [suggestionsHeight, setSuggestionsHeight] = useState<number | undefined>(undefined);
    const [modalHeight, setModalHeight] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (modalRef.current && inputRef.current && suggestionsWrapperRef.current) {
            const modalPadding = 32;
            const inputHeight = inputRef.current.getBoundingClientRect().height;
            let suggestionsTotalHeight = 0;

            const suggestionItems = suggestionsWrapperRef.current.children;
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
    }, [height, suggestions.length]);

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

    const renderModal = () => (
        <div className="type-ahead-modal-wrapper" onKeyDown={handleKeyDown}>
            {renderBackdrop(onClickBackdrop)}
            <div
                ref={modalRef}
                className={clsx("type-ahead-modal", className)}
                style={{
                    width: width * 0.6,
                    maxHeight: modalHeight,
                }}
            >
                <div className="content-wrapper">
                    <Input
                        ref={inputRef}
                        onChange={handleChange}
                        value={value}
                        autoFocus
                        decoration={{
                            startDecoration: (
                                <InputDecoration position="start">
                                    <div className="label">{label}</div>
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
                        <Suggestions ref={suggestionsWrapperRef} suggestions={suggestions} onSelect={handleSelect} />
                    </div>
                </div>
            </div>
        </div>
    );

    if (anchor.current == null) {
        return null;
    }

    return ReactDOM.createPortal(renderModal(), anchor.current);
};

export { TypeAheadModal };
export type { SuggestionType };
