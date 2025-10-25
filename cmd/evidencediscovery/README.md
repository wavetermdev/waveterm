# Federal Evidence Discovery Tool

E2B Evidence Discovery Script for Federal Case Management and Evidence_Vault population.

## Overview

This tool performs federal-grade evidence discovery, generating NDJSON output suitable for bulk import into Evidence_Vault systems with complete chain of custody and federal compliance metadata.

## Features

- **SHA-256 Hashing**: Cryptographic verification of all evidence files
- **MIME Type Detection**: Automatic file type identification
- **Evidence Categorization**: Intelligent categorization based on file type and content
- **Federal Compliance**: Complete metadata for legal admissibility
- **Cross-Platform**: Works on Linux, macOS, and in E2B sandboxes
- **NDJSON Output**: Standard format for bulk processing systems

## Installation

### Prerequisites

- Go 1.19+ (for Go version) or Python 3.6+ (for fallback version)
- Standard Unix tools (find, stat, etc.)

### Quick Setup

```bash
# Make script executable
chmod +x cmd/evidencediscovery/discovery.sh

# Run discovery
./cmd/evidencediscovery/discovery.sh
```

## Usage

### Basic Usage

```bash
# Discover evidence in current directory
./cmd/evidencediscovery/discovery.sh

# Discover evidence in specific directories
./cmd/evidencediscovery/discovery.sh /evidence_vault /documents

# Specify case ID and output file
./cmd/evidencediscovery/discovery.sh --case-id 1FDV-23-0001009 --output case_evidence.ndjson
```

### Command Line Options

- `--case-id ID`: Case identifier for evidence discovery (default: 1FDV-23-0001009)
- `--output FILE`: Output NDJSON file path (default: evidence_discovery.ndjson)
- `--help`: Show help message

### Examples

```bash
# Standard federal evidence discovery
./cmd/evidencediscovery/discovery.sh --case-id 1FDV-23-0001009

# Medical records discovery
./cmd/evidencediscovery/discovery.sh --case-id MED-2025-001 /medical_records

# Multi-directory discovery
./cmd/evidencediscovery/discovery.sh /evidence_vault /court_filings /email_exports
```

## Output Format

The tool generates NDJSON (Newline-Delimited JSON) output with the following structure:

```json
{
  "path": "/evidence_vault/document.pdf",
  "size": 1024576,
  "sha256": "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
  "modified_at": "2025-10-24T15:30:00Z",
  "created_at": "2025-10-24T14:22:00Z",
  "type": "file",
  "mime": "application/pdf",
  "extension": ".pdf",
  "filename": "document.pdf",
  "parent_directory": "/evidence_vault",
  "permissions": "0644",
  "case_id": "1FDV-23-0001009",
  "discovery_timestamp": "2025-10-24T17:45:00Z",
  "federal_compliance": true,
  "evidence_category": "DOCUMENT_PDF"
}
```

## Evidence Categories

The tool automatically categorizes evidence based on file type:

- **AUDIO_RECORDING**: Audio files (MP3, WAV, etc.)
- **VIDEO_RECORDING**: Video files (MP4, AVI, etc.)
- **PHOTOGRAPH**: Image files (JPG, PNG, GIF, etc.)
- **DOCUMENT_PDF**: PDF documents
- **DOCUMENT_OFFICE**: Word/Excel documents
- **TEXT_DOCUMENT**: Text files
- **EMAIL_EVIDENCE**: Email exports and communications
- **MEDICAL_RECORD**: Medical documentation
- **COURT_FILING**: Court documents and legal filings
- **FINANCIAL_RECORD**: Financial evidence
- **DIGITAL_EVIDENCE**: Other digital files

## E2B Integration

### Running in E2B Sandbox

```bash
# Copy to E2B environment
cp cmd/evidencediscovery/discovery.sh /path/in/e2b/

# Execute discovery
cd /path/in/e2b/
./discovery.sh --case-id 1FDV-23-0001009 --output evidence.ndjson
```

### Processing NDJSON Output

The generated NDJSON file can be directly imported into Evidence_Vault systems:

```bash
# Validate NDJSON format
cat evidence_discovery.ndjson | jq .

# Count total evidence items
wc -l evidence_discovery.ndjson

# Get file size distribution
cat evidence_discovery.ndjson | jq -r '.size' | paste -sd+ | bc

# Extract evidence categories
cat evidence_discovery.ndjson | jq -r '.evidence_category' | sort | uniq -c
```

## Federal Compliance

This tool generates evidence records that meet federal evidence standards:

- **Chain of Custody**: Complete timestamp and operator tracking
- **Hash Verification**: SHA-256 cryptographic verification
- **Metadata Preservation**: Complete file system metadata
- **Standard Format**: Industry-standard NDJSON output
- **Case Association**: Proper case ID linkage

## Building from Source

### Go Version

```bash
cd cmd/evidencediscovery/
go build -o evidence-discovery main.go
./evidence-discovery output.ndjson 1FDV-23-0001009 /evidence_paths
```

### Python Fallback

The script includes a Python fallback version that runs automatically if Go is not available:

```bash
python3 cmd/evidencediscovery/discovery.sh
```

## Troubleshooting

### Common Issues

1. **Permission Denied**: Ensure the script is executable (`chmod +x discovery.sh`)
2. **Path Not Found**: Verify evidence directories exist before scanning
3. **Go Not Available**: The script will automatically fall back to Python version
4. **Large Files**: SHA-256 computation may take time for very large files

### Performance Tips

- Use specific paths instead of scanning entire filesystems
- Process evidence in smaller batches for large cases
- Consider excluding temporary or cache directories
- Use SSD storage for better I/O performance

## Security Considerations

- All file hashes use SHA-256 cryptographic standard
- File paths are absolute and fully qualified
- Timestamps are in UTC with ISO 8601 format
- Permissions are preserved in octal format
- No file contents are stored, only metadata

## License

Copyright 2025, Command Line Inc.
SPDX-License-Identifier: Apache-2.0
