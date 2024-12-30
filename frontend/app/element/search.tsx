// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { autoUpdate, FloatingPortal, Middleware, offset, useFloating } from "@floating-ui/react";
import clsx from "clsx";
import { atom, useAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { IconButton, ToggleIconButton } from "./iconbutton";
import { Input } from "./input";
import "./search.scss";

type SearchProps = SearchAtoms & {
    anchorRef?: React.RefObject<HTMLElement>;
    offsetX?: number;
    offsetY?: number;
    onSearch?: (search: string) => void;
    onNext?: () => void;
    onPrev?: () => void;
};

const SearchComponent = ({
    searchValue: searchAtom,
    resultsIndex: indexAtom,
    resultsCount: numResultsAtom,
    regex: regexAtom,
    caseSensitive: caseSensitiveAtom,
    wholeWord: wholeWordAtom,
    isOpen: isOpenAtom,
    anchorRef,
    offsetX = 10,
    offsetY = 10,
    onSearch,
    onNext,
    onPrev,
}: SearchProps) => {
    const [isOpen, setIsOpen] = useAtom<boolean>(isOpenAtom);
    const [search, setSearch] = useAtom<string>(searchAtom);
    const [index, setIndex] = useAtom<number>(indexAtom);
    const [numResults, setNumResults] = useAtom<number>(numResultsAtom);

    const handleOpenChange = useCallback((open: boolean) => {
        setIsOpen(open);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            setSearch("");
            setIndex(0);
            setNumResults(0);
        }
    }, [isOpen]);

    useEffect(() => {
        setIndex(0);
        setNumResults(0);
        onSearch?.(search);
    }, [search]);

    const middleware: Middleware[] = [];
    const offsetCallback = useCallback(
        ({ rects }) => {
            const docRect = document.documentElement.getBoundingClientRect();
            let yOffsetCalc = -rects.floating.height - offsetY;
            let xOffsetCalc = -offsetX;
            const floatingBottom = rects.reference.y + rects.floating.height + offsetY;
            const floatingLeft = rects.reference.x + rects.reference.width - (rects.floating.width + offsetX);
            if (floatingBottom > docRect.bottom) {
                yOffsetCalc -= docRect.bottom - floatingBottom;
            }
            if (floatingLeft < 5) {
                xOffsetCalc += 5 - floatingLeft;
            }
            return {
                mainAxis: yOffsetCalc,
                crossAxis: xOffsetCalc,
            };
        },
        [offsetX, offsetY]
    );
    middleware.push(offset(offsetCallback));

    const { refs, floatingStyles } = useFloating({
        placement: "top-end",
        open: isOpen,
        onOpenChange: handleOpenChange,
        whileElementsMounted: autoUpdate,
        middleware,
        elements: {
            reference: anchorRef!.current,
        },
    });

    const onPrevWrapper = useCallback(
        () => (onPrev ? onPrev() : setIndex((index - 1) % numResults)),
        [onPrev, index, numResults]
    );
    const onNextWrapper = useCallback(
        () => (onNext ? onNext() : setIndex((index + 1) % numResults)),
        [onNext, index, numResults]
    );

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                if (e.shiftKey) {
                    onPrevWrapper();
                } else {
                    onNextWrapper();
                }
                e.preventDefault();
            }
        },
        [onPrevWrapper, onNextWrapper, setIsOpen]
    );

    const prevDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "chevron-up",
        title: "Previous Result (Shift+Enter)",
        disabled: numResults === 0,
        click: onPrevWrapper,
    };

    const nextDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "chevron-down",
        title: "Next Result (Enter)",
        disabled: numResults === 0,
        click: onNextWrapper,
    };

    const closeDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "xmark-large",
        title: "Close (Esc)",
        click: () => setIsOpen(false),
    };

    const regexDecl: ToggleIconButtonDecl = regexAtom
        ? {
              elemtype: "toggleiconbutton",
              icon: "asterisk",
              title: "Regex Search",
              active: regexAtom,
          }
        : null;
    const wholeWordDecl: ToggleIconButtonDecl = caseSensitiveAtom
        ? {
              elemtype: "toggleiconbutton",
              icon: "w",
              title: "Whole Word",
              active: wholeWordAtom,
          }
        : null;
    const caseSensitiveDecl: ToggleIconButtonDecl = caseSensitiveAtom
        ? {
              elemtype: "toggleiconbutton",
              icon: "font-case",
              title: "Case Sensitive",
              active: caseSensitiveAtom,
          }
        : null;

    return (
        <>
            {isOpen && (
                <FloatingPortal>
                    <div className="search-container" style={{ ...floatingStyles }} ref={refs.setFloating}>
                        <Input
                            placeholder="Search"
                            value={search}
                            onChange={setSearch}
                            onKeyDown={onKeyDown}
                            autoFocus
                        />
                        <div
                            className={clsx("search-results", { hidden: numResults === 0 })}
                            aria-live="polite"
                            aria-label="Search Results"
                        >
                            {index + 1}/{numResults}
                        </div>

                        <div className="right-buttons additional">
                            {caseSensitiveDecl && <ToggleIconButton decl={caseSensitiveDecl} />}
                            {wholeWordDecl && <ToggleIconButton decl={wholeWordDecl} />}
                            {regexDecl && <ToggleIconButton decl={regexDecl} />}
                        </div>

                        <div className="right-buttons">
                            <IconButton decl={prevDecl} />
                            <IconButton decl={nextDecl} />
                            <IconButton decl={closeDecl} />
                        </div>
                    </div>
                </FloatingPortal>
            )}
        </>
    );
};

export const Search = memo(SearchComponent) as typeof SearchComponent;

type SearchOptions = {
    anchorRef?: React.RefObject<HTMLElement>;
    viewModel?: ViewModel;
    regex?: boolean;
    caseSensitive?: boolean;
    wholeWord?: boolean;
};

export function useSearch(options?: SearchOptions): SearchProps {
    const searchAtoms: SearchAtoms = useMemo(
        () => ({
            searchValue: atom(""),
            resultsIndex: atom(0),
            resultsCount: atom(0),
            isOpen: atom(false),
            regex: options?.regex !== undefined ? atom(options.regex) : undefined,
            caseSensitive: options?.caseSensitive !== undefined ? atom(options.caseSensitive) : undefined,
            wholeWord: options?.wholeWord !== undefined ? atom(options.wholeWord) : undefined,
        }),
        []
    );
    const anchorRef = options?.anchorRef ?? useRef(null);
    useEffect(() => {
        if (options?.viewModel) {
            options.viewModel.searchAtoms = searchAtoms;
            return () => {
                options.viewModel.searchAtoms = undefined;
            };
        }
    }, [options?.viewModel]);
    return { ...searchAtoms, anchorRef };
}
