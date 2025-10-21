// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, globalStore } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import * as semver from "semver";
import { UpgradeOnboardingModal_v0_12_0 } from "./onboarding-upgrade-v0120";
import { UpgradeOnboardingModal_v0_12_1 } from "./onboarding-upgrade-v0121";

const UpgradeOnboardingModal = () => {
    const clientData = useAtomValue(atoms.client);
    const initialVersionRef = useRef<string | null>(null);

    if (initialVersionRef.current == null) {
        initialVersionRef.current = clientData.meta?.["onboarding:lastversion"] ?? "v0.0.0";
    }

    const lastVersion = initialVersionRef.current;

    useEffect(() => {
        if (semver.gte(lastVersion, "v0.12.1")) {
            globalStore.set(modalsModel.upgradeOnboardingOpen, false);
        }
    }, [lastVersion]);

    if (semver.gte(lastVersion, "v0.12.1")) {
        return null;
    }

    if (semver.gte(lastVersion, "v0.12.0")) {
        return <UpgradeOnboardingModal_v0_12_1 />;
    }

    return <UpgradeOnboardingModal_v0_12_0 />;
};

UpgradeOnboardingModal.displayName = "UpgradeOnboardingModal";

export { UpgradeOnboardingModal };
