import "./versionbadge.css";

interface VersionBadgeProps {
    version: string;
}

export function VersionBadge({ version }: VersionBadgeProps) {
    return <span className="version-badge">{version}</span>;
}