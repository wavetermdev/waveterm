// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import "./copybutton.scss";
import { IconButton } from "./iconbutton";

type CopyButtonProps = {
    title: string;
    className?: string;
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

const CopyButton = ({ title, className, onClick }: CopyButtonProps) => {
    const [isCopied, setIsCopied] = useState(false);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

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

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return (
        <IconButton
            decl={{
                elemtype: "iconbutton",
                icon: isCopied ? "check" : "copy",
                title,
                className: clsx("copy-button", { copied: isCopied }),
                click: handleOnClick,
            }}
            className={className}
        ></IconButton>
    );
};

export { CopyButton };
