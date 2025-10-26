// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useLongClick } from "@/app/hook/useLongClick";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { atom, useAtom } from "jotai";
import { CSSProperties, forwardRef, memo, useMemo, useRef } from "react";
import "./iconbutton.scss";

type IconButtonProps = { decl: IconButtonDecl; className?: string };
export const IconButton = memo(
    forwardRef<HTMLButtonElement, IconButtonProps>(({ decl, className }, ref) => {
        ref = ref ?? useRef<HTMLButtonElement>(null);
        const spin = decl.iconSpin ?? false;
        useLongClick(ref, decl.click, decl.longClick, decl.disabled);
        const disabled = decl.disabled ?? false;
        const styleVal: CSSProperties = {};
        if (decl.iconColor) {
            styleVal.color = decl.iconColor;
        }
        return (
            <button
                ref={ref}
                className={clsx("wave-iconbutton", className, decl.className, {
                    disabled,
                    "no-action": decl.noAction,
                })}
                title={decl.title}
                aria-label={decl.title}
                style={styleVal}
                disabled={disabled}
            >
                {typeof decl.icon === "string" ? <i className={makeIconClass(decl.icon, true, { spin })} /> : decl.icon}
            </button>
        );
    })
);

type ToggleIconButtonProps = { decl: ToggleIconButtonDecl; className?: string };

export const ToggleIconButton = memo(
    forwardRef<HTMLButtonElement, ToggleIconButtonProps>(({ decl, className }, ref) => {
        const activeAtom = useMemo(() => decl.active ?? atom(false), [decl.active]);
        const [active, setActive] = useAtom(activeAtom);
        ref = ref ?? useRef<HTMLButtonElement>(null);
        const spin = decl.iconSpin ?? false;
        const title = `${decl.title}${active ? " (Active)" : ""}`;
        const disabled = decl.disabled ?? false;
        return (
            <button
                ref={ref}
                className={clsx("wave-iconbutton", "toggle", className, decl.className, {
                    active,
                    disabled,
                    "no-action": decl.noAction,
                })}
                title={title}
                aria-label={title}
                style={{ color: decl.iconColor ?? "inherit" }}
                onClick={() => setActive(!active)}
                disabled={disabled}
            >
                {typeof decl.icon === "string" ? <i className={makeIconClass(decl.icon, true, { spin })} /> : decl.icon}
            </button>
        );
    })
);
