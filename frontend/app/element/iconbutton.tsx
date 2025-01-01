// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useLongClick } from "@/app/hook/useLongClick";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { atom, useAtom } from "jotai";
import { memo, useMemo, useRef } from "react";
import "./iconbutton.scss";

type IconButtonProps = { decl: IconButtonDecl; className?: string; ref?: React.RefObject<HTMLButtonElement> };
export const IconButton = memo(({ decl, className, ref }: IconButtonProps) => {
    ref = ref ?? useRef<HTMLButtonElement>(null);
    const spin = decl.iconSpin ?? false;
    useLongClick(ref, decl.click, decl.longClick, decl.disabled);
    const disabled = decl.disabled ?? false;
    return (
        <button
            ref={ref}
            className={clsx("wave-iconbutton", className, decl.className, {
                disabled,
                "no-action": decl.noAction,
            })}
            title={decl.title}
            aria-label={decl.title}
            style={{ color: decl.iconColor ?? "inherit" }}
            disabled={disabled}
        >
            {typeof decl.icon === "string" ? <i className={makeIconClass(decl.icon, true, { spin })} /> : decl.icon}
        </button>
    );
});

type ToggleIconButtonProps = {
    decl: ToggleIconButtonDecl;
    className?: string;
    ref?: React.RefObject<HTMLButtonElement>;
};

export const ToggleIconButton = memo(({ decl, className, ref }: ToggleIconButtonProps) => {
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
});
