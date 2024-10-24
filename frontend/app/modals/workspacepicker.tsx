import { useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { memo, useState } from "react";
import { Button } from "../element/button";
import "./workspacepicker.less";

type WorkspacePickerProps = {};

type WorkspaceButtonProps = WorkspacePickerProps & {
    onClick: () => void;
};

const WorkspaceButton = memo(({}: WorkspaceButtonProps) => {
    return <Button>Workspace Picker</Button>;
});

function WorkspacePickerComponent(props: WorkspacePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const onOpenChangeMenu = (isOpen: boolean) => {
        setIsOpen(isOpen);
    };
    const { refs, floatingStyles, context } = useFloating({
        placement: "bottom-start",
        open: isOpen,
        onOpenChange: onOpenChangeMenu,
    });
    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);
    return (
        <div className="workspace-picker">
            <WorkspaceButton {...props} onClick={() => onOpenChangeMenu(!isOpen)} />
            {isOpen && <div className="workspace-pane"></div>}
        </div>
    );
}

export const WorkspacePicker = memo(WorkspacePickerComponent) as typeof WorkspacePickerComponent;
