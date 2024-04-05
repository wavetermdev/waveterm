import React from "react";
import { Button } from "./button";

import "./copybutton.less";

type CopyButtonProps = {
    isCopied: boolean;
    title: string;
    onClick: (e: any) => void;
};

const CopyButton: React.FC<CopyButtonProps> = ({ isCopied, title, onClick }) => {
    return (
        <Button onClick={onClick} className="copy-button secondary ghost" title={title}>
            {isCopied ? <i className="fa-sharp fa-solid fa-check"></i> : <i className="fa-sharp fa-solid fa-copy"></i>}
        </Button>
    );
};

export { CopyButton };
