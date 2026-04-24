// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function getProfileDisplayName(key: string, profile: MetaType): string {
    return (profile?.["display:name"] as string) || key;
}

export function profileToBlockMeta(profile: MetaType): MetaType {
    if (profile == null) return null;
    const blockMeta: MetaType = {};
    for (const [k, v] of Object.entries(profile)) {
        if (k.startsWith("display:") || k.startsWith("tab:")) continue;
        blockMeta[k as keyof MetaType] = v as any;
    }
    return Object.keys(blockMeta).length > 0 ? blockMeta : null;
}

export function getSortedProfiles(profiles: { [key: string]: MetaType }): { key: string; profile: MetaType }[] {
    if (profiles == null) return [];
    return Object.entries(profiles)
        .map(([key, profile]) => ({ key, profile }))
        .sort((a, b) => {
            const orderA = (a.profile?.["display:order"] as number) ?? 0;
            const orderB = (b.profile?.["display:order"] as number) ?? 0;
            if (orderA !== orderB) return orderA - orderB;
            return getProfileDisplayName(a.key, a.profile).localeCompare(getProfileDisplayName(b.key, b.profile));
        });
}
