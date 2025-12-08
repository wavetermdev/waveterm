// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, globalStore } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import * as semver from "semver";
import { CurrentOnboardingVersion } from "./onboarding-common";
import { UpgradeOnboardingMinor } from "./onboarding-upgrade-minor";
import { UpgradeOnboardingPatch } from "./onboarding-upgrade-patch";

const UpgradeOnboardingModal = () => {
    const clientData = useAtomValue(atoms.client);
    const initialVersionRef = useRef<string | null>(null);

    if (initialVersionRef.current == null) {
        initialVersionRef.current = clientData.meta?.["onboarding:lastversion"] ?? "v0.0.0";
    }

    const lastVersion = initialVersionRef.current;

    useEffect(() => {
        if (semver.gte(lastVersion, CurrentOnboardingVersion)) {
            globalStore.set(modalsModel.upgradeOnboardingOpen, false);
        }
    }, [lastVersion]);

    if (semver.gte(lastVersion, CurrentOnboardingVersion)) {
        return null;
    }

    if (semver.gte(lastVersion, "v0.12.0")) {
        return <UpgradeOnboardingPatch />;
    }

    return <UpgradeOnboardingMinor />;
};

UpgradeOnboardingModal.displayName = "UpgradeOnboardingModal";

export { UpgradeOnboardingModal };
