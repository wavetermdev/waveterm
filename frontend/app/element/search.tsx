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
                    <div className="search-container" style={floatingStyles} {...dismiss} ref={refs.setFloating}>
                        <Input placeholder="Search" value={search} onChange={setSearch} />
                        <div className={clsx("search-results", { hidden: numResults === 0 })}>
                            {index} / {numResults}
                        </div>
                        <IconButton decl={closeDecl} />
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
    const [numResultsAtom] = useState(atom(1));
    const [isOpenAtom] = useState(atom(false));
    anchorRef ??= useRef(null);
    return { searchAtom, indexAtom, numResultsAtom, isOpenAtom, anchorRef };
}
