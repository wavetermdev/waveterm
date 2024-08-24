import { Input } from "@/app/element/input";
import { InputDecoration } from "@/app/element/inputdecoration";
import { useDimensions } from "@/app/hook/useDimensions";
import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";
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

function Suggestions({ suggestions, onSelect }: SuggestionsProps) {
    const suggestionsWrapperRef = useRef<HTMLDivElement>(null);

    return (
        <div
            ref={suggestionsWrapperRef}
            className="suggestions-wrapper"
            style={{ marginTop: suggestions?.length > 0 ? "8px" : "0" }}
        >
            {suggestions?.map((suggestion, index) => (
                <div className="suggestion" key={index} onClick={() => onSelect(suggestion.value)}>
                    {suggestion.label}
                </div>
            ))}
        </div>
    );
}

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
    const [suggestionsHeight, setSuggestionsHeight] = useState<number | undefined>(undefined);

    useEffect(() => {
        if (modalRef.current && inputRef.current) {
            const modalHeight = modalRef.current.getBoundingClientRect().height;
            const inputHeight = inputRef.current.getBoundingClientRect().height;

            // Get the padding value (assuming padding is uniform on all sides)
            const padding = 16 * 2; // 16px top + 16px bottom

            // Subtract the input height and padding from the modal height
            setSuggestionsHeight(modalHeight - inputHeight - padding);
        }
    }, [width, height]);

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
                    maxHeight: height * 0.8,
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
                        <Suggestions suggestions={suggestions} onSelect={handleSelect} />
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
