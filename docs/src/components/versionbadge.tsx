import "./versionbadge.css";

interface VersionBadgeProps {
    version: string;
    noLeftMargin?: boolean;
}

export function VersionBadge({ version, noLeftMargin }: VersionBadgeProps) {
    return <span className={`version-badge${noLeftMargin ? " no-left-margin" : ""}`}>{version}</span>;
}