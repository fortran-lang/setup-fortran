#!/usr/bin/env python3
"""
Read compat.csv and write a lookup table
of the latest working versions to a .sh
file to source at run time.
"""

import csv
import sys
from pathlib import Path


def version_sort_key(version: str):
    """Convert version string to sortable tuple of integers."""
    # Handle versions like "13", "14", "2023.2", "0.57.0", etc.
    parts = str(version).replace("'", "").split('.')
    return tuple(int(p) if p.isdigit() else 0 for p in parts)


def parse_compat_csv(csv_path):
    """
    Parse compat.csv and return latest working version for each OS/compiler combo.

    CSV format:
    Row 1: compiler,gcc,gcc,gcc,intel,intel,...
    Row 2: version,13,14,15,2021.1,2021.2,...
    Row 3: runner,,,,,,...
    Row 4+: os-name,&check;,,&check;,...

    Returns: dict[compiler][os] = latest_version
    """
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        rows = list(reader)

    if len(rows) < 4:
        raise ValueError(f"CSV must have at least 4 rows, got {len(rows)}")

    # Parse header rows
    compiler_row = rows[0]
    version_row = rows[1]
    # Skip row 2 (runner header)

    # Build list of (compiler, version, column_index)
    columns = []
    for i in range(1, len(compiler_row)):  # Skip first column (label)
        compiler = compiler_row[i]
        version = version_row[i]
        if compiler and version:  # Skip empty columns
            columns.append((compiler, version, i))

    # Parse OS rows and find latest version for each OS/compiler
    latest_versions = {}

    for row_idx in range(3, len(rows)):  # Start after runner header
        row = rows[row_idx]
        if not row or not row[0]:  # Skip empty rows
            continue

        os_name = row[0]

        # Check each column for this OS
        for compiler, version, col_idx in columns:
            if col_idx < len(row) and row[col_idx] == '&check;':
                # This OS/compiler/version combo works
                if compiler not in latest_versions:
                    latest_versions[compiler] = {}

                # Update if this is the first or highest version for this OS/compiler
                if os_name not in latest_versions[compiler]:
                    latest_versions[compiler][os_name] = version
                else:
                    current = latest_versions[compiler][os_name]
                    if version_sort_key(version) > version_sort_key(current):
                        latest_versions[compiler][os_name] = version

    return latest_versions


def to_lines(latest_versions) -> list[str]:
    """
    Variable names follow pattern: LATEST_<compiler>_<os>
    where both compiler and os have . and - replaced with _
    """

    lines = []
    for compiler, os_versions in sorted(latest_versions.items()):
        compiler_safe = compiler.replace('-', '_').replace('.', '_')
        lines.append(f"# Latest supported {compiler} versions by runner")
        for os_name, version in sorted(os_versions.items()):
            os_safe = os_name.replace('-', '_').replace('.', '_')
            var_name = f"LATEST_{compiler_safe}_{os_safe}"
            lines.append(f'{var_name}="{version}"')
        lines.append("")

    return lines


def main():
    if len(sys.argv) != 3:
        print("Usage: update_latest_versions.py <compat.csv> <output.sh>")
        sys.exit(1)

    csv_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not csv_path.is_file():
        print(f"Error: {csv_path} not found")
        sys.exit(1)

    latest_versions = parse_compat_csv(csv_path)
    variable_lines = to_lines(latest_versions)

    with open(output_path, 'w') as f:
        prefix_lines = [
            f"# Auto-generated from {csv_path.name}",
            "# DO NOT EDIT MANUALLY - Run .github/compat/update_latest_versions.py to regenerate",
            "",
        ]
        f.write("\n".join(prefix_lines + variable_lines))

    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
