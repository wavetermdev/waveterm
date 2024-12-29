/**
 * @name Missing SPDX License Identifier
 * @description Identifies files that don't begin with an SPDX license identifier
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id custom/missing-spdx-identifier
 */

import javascript
import go

/**
 * Holds if the file starts with an SPDX license identifier.
 * The pattern matches variations of the SPDX identifier format.
 */
predicate hasSPDXHeader(File f) {
  exists(string content, int startIndex |
    content = f.getContents() and
    // Find first non-whitespace character
    startIndex = min(int i | exists(content.charAt(i)) and not content.charAt(i).regexpMatch("\\s")) and
    // Check if the content starts with SPDX identifier
    content
        .substring(startIndex, startIndex + 200)
        .regexpMatch("(?s)/[/*#].*SPDX-License-Identifier:\\s*[\\w\\.\\-+]+.*")
  )
}

from File f
where
  // Include relevant file types
  (
    f.getExtension() = "go" or
    f.getExtension() = "ts" or
    f.getExtension() = "tsx" or
    f.getExtension() = "js" or
    f.getExtension() = "jsx" or
    f.getExtension() = "scss" or
    f.getExtension() = "py"
  ) and
  // Exclude test files and generated code
  not f.getAbsolutePath().matches("%/test/%") and
  not f.getAbsolutePath().matches("%/generated/%") and
  // Check if file doesn't have SPDX header
  not hasSPDXHeader(f)
select f, "File is missing SPDX license identifier at the beginning"
