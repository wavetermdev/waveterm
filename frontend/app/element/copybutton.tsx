// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { clsx } from "clsx";
import * as React from "react";
import { Button } from "./button";

import "./copybutton.less";

type CopyButtonProps = {
    title: string;
    className?: string;
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

const CopyButton = ({ title, className, onClick }: CopyButtonProps) => {
    const [isCopied, setIsCopied] = React.useState(false);
    const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    const handleOnClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (isCopied) {
            return;
        }
        setIsCopied(true);
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
            setIsCopied(false);
            timeoutRef.current = null;
        }, 2000);

        if (onClick) {
            onClick(e);
        }
    };

    React.useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return (
        <Button onClick={handleOnClick} className={clsx("copy-button secondary ghost", className)} title={title}>
            {isCopied ? <i className="fa-sharp fa-solid fa-check"></i> : <i className="fa-sharp fa-solid fa-copy"></i>}
        </Button>
    );
};

export { CopyButton };
