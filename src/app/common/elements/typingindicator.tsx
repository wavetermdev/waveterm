import React from "react";
import { clsx } from "clsx";

import "./typingindicator.less";

type Props = {
    className?: string;
};
const TypingIndicator: React.FC<Props> = (props: { className?: string }) => {
    return (
        <div className={clsx("typing", props.className)}>
            <span></span>
            <span></span>
            <span></span>
        </div>
    );
};

export { TypingIndicator };
