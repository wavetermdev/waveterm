import { clsx } from "clsx";

import "./typingindicator.less";

type TypingIndicatorProps = {
    className?: string;
};
const TypingIndicator = ({ className }: TypingIndicatorProps) => {
    return (
        <div className={clsx("typing", className)}>
            <span></span>
            <span></span>
            <span></span>
        </div>
    );
};

export { TypingIndicator };
