import { Button } from "@/element/button";
import { atoms, getApi } from "@/store/global";
import { useAtomValue } from "jotai";
import { memo } from "react";
import "./updatestatus.less";

const UpdateStatusBannerComponent = ({ buttonRef }: { buttonRef: React.RefObject<HTMLButtonElement> }) => {
    const appUpdateStatus = useAtomValue(atoms.updaterStatusAtom);
    function onClick() {
        getApi().installAppUpdate();
    }

    let buttonText: string;
    switch (appUpdateStatus) {
        case "ready":
            buttonText = "Update Available";
            break;
        case "checking":
            buttonText = "Checking for Updates";
            break;
        case "downloading":
            buttonText = "Downloading Update";
            break;
        case "installing":
            buttonText = "Installing Update";
            break;
        case "error":
            buttonText = "Updater Error: Try Checking Again";
            break;
        default:
            break;
    }

    if (buttonText) {
        return (
            <Button
                ref={buttonRef}
                className="update-available-button"
                title={appUpdateStatus === "ready" ? "Click to Install Update" : buttonText}
                onClick={onClick}
                disabled={appUpdateStatus !== "ready"}
            >
                {buttonText}
            </Button>
        );
    }
};

export const UpdateStatusBanner = memo(UpdateStatusBannerComponent) as typeof UpdateStatusBannerComponent;
