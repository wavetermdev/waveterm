import { autoUpdate, FloatingPortal, Middleware, offset, useDismiss, useFloating } from "@floating-ui/react";
import clsx from "clsx";
import { atom, PrimitiveAtom, useAtom, useAtomValue } from "jotai";
import { memo, useCallback, useRef, useState } from "react";
import { IconButton } from "./iconbutton";
import { Input } from "./input";
import "./search.scss";

type SearchProps = {
    searchAtom: PrimitiveAtom<string>;
    indexAtom: PrimitiveAtom<number>;
    numResultsAtom: PrimitiveAtom<number>;
    isOpenAtom: PrimitiveAtom<boolean>;
    anchorRef?: React.RefObject<HTMLElement>;
    offsetX?: number;
    offsetY?: number;
};

const SearchComponent = ({
    searchAtom,
    indexAtom,
    numResultsAtom,
    isOpenAtom,
    anchorRef,
    offsetX = 10,
    offsetY = 10,
}: SearchProps) => {
    const [isOpen, setIsOpen] = useAtom(isOpenAtom);
    const [search, setSearch] = useAtom(searchAtom);
    const [index, setIndex] = useAtom(indexAtom);
    const numResults = useAtomValue(numResultsAtom);

    const handleOpenChange = useCallback((open: boolean) => {
        setIsOpen(open);
    }, []);

    const middleware: Middleware[] = [];
    middleware.push(
        offset(({ rects }) => ({
            mainAxis: -rects.floating.height - offsetY,
            crossAxis: -offsetX,
        }))
    );

    const { refs, floatingStyles, context } = useFloating({
        placement: "top-end",
        open: isOpen,
        onOpenChange: handleOpenChange,
        whileElementsMounted: autoUpdate,
        middleware,
        elements: {
            reference: anchorRef!.current,
        },
    });

    const dismiss = useDismiss(context);

    const prevDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "chevron-up",
        title: "Previous Result",
        disabled: index === 0,
        click: () => setIndex(index - 1),
    };

    const nextDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "chevron-down",
        title: "Next Result",
        disabled: !numResults || index === numResults - 1,
        click: () => setIndex(index + 1),
    };

    const closeDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "xmark-large",
        title: "Close",
        click: () => setIsOpen(false),
    };

    return (
        <>
            {isOpen && (
                <FloatingPortal>
                    <div className="search-container" style={{ ...floatingStyles }} {...dismiss} ref={refs.setFloating}>
                        <Input placeholder="Search" value={search} onChange={setSearch} />
                        <div
                            className={clsx("search-results", { hidden: numResults === 0 })}
                            aria-live="polite"
                            aria-label="Search Results"
                        >
                            {index + 1}/{numResults}
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

export function useSearch(anchorRef?: React.RefObject<HTMLElement>): SearchProps {
    const [searchAtom] = useState(atom(""));
    const [indexAtom] = useState(atom(0));
    const [numResultsAtom] = useState(atom(0));
    const [isOpenAtom] = useState(atom(false));
    anchorRef ??= useRef(null);
    return { searchAtom, indexAtom, numResultsAtom, isOpenAtom, anchorRef };
}
