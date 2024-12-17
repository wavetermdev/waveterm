// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useLongClick } from "@/app/hook/useLongClick";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { forwardRef, memo, useRef } from "react";
import "./iconbutton.scss";

type IconButtonProps = { decl: IconButtonDecl; className?: string };
export const IconButton = memo(
    forwardRef<HTMLButtonElement, IconButtonProps>(({ decl, className }, ref) => {
        ref = ref ?? useRef<HTMLButtonElement>(null);
        const spin = decl.iconSpin ?? false;
        useLongClick(ref, decl.click, decl.longClick, decl.disabled);
        return (
            <button
                ref={ref}
                className={clsx("wave-iconbutton", className, decl.className, {
                    disabled: decl.disabled,
                    "no-action": decl.noAction,
                })}
                title={decl.title}
                style={{ color: decl.iconColor ?? "inherit" }}
            >
                {typeof decl.icon === "string" ? <i className={makeIconClass(decl.icon, true, { spin })} /> : decl.icon}
            </button>
        );
    })
);
