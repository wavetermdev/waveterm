import { Button } from "@/element/button";
import { atoms, getApi } from "@/store/global";
import { useAtomValue } from "jotai";
import { forwardRef, memo, useEffect, useState } from "react";

const UpdateStatusBannerComponent = forwardRef<HTMLButtonElement>((_, ref) => {
    let appUpdateStatus = useAtomValue(atoms.updaterStatusAtom);
    let [updateStatusMessage, setUpdateStatusMessage] = useState<string>();
    const [dismissBannerTimeout, setDismissBannerTimeout] = useState<NodeJS.Timeout>();

    useEffect(() => {
        let message: string;
        let dismissBanner = false;
        switch (appUpdateStatus) {
            case "ready":
                message = "Update Available";
                break;
            case "downloading":
                message = "Downloading Update";
                break;
            case "installing":
                message = "Installing Update";
                break;
            case "error":
                message = "Updater Error: Try Checking Again";
                dismissBanner = true;
                break;
            default:
                break;
        }
        setUpdateStatusMessage(message);

        // Clear any existing timeout
        if (dismissBannerTimeout) {
            clearTimeout(dismissBannerTimeout);
        }

        // If we want to dismiss the banner, set the new timeout, otherwise clear the state
        if (dismissBanner) {
            setDismissBannerTimeout(
                setTimeout(() => {
                    setUpdateStatusMessage(null);
                    setDismissBannerTimeout(null);
                }, 10000)
            );
        } else {
            setDismissBannerTimeout(null);
        }
    }, [appUpdateStatus]);

    function onClick() {
        getApi().installAppUpdate();
    }
    if (updateStatusMessage) {
        return (
            <Button
                className="text-black bg-[var(--accent-color)] flex-[0_0_fit-content] !h-full !px-3 disabled:!opacity-[unset]"
                title={appUpdateStatus === "ready" ? "Click to Install Update" : updateStatusMessage}
                onClick={onClick}
                disabled={appUpdateStatus !== "ready"}
                ref={ref}
            >
                {updateStatusMessage}
            </Button>
        );
    }
});

export const UpdateStatusBanner = memo(UpdateStatusBannerComponent) as typeof UpdateStatusBannerComponent;
