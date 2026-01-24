#!/usr/bin/env python3
"""
Read matrix.yml and write a lookup
table of the latest versions to a
.env file to source at run time.
"""

import sys
from pathlib import Path
import yaml


def parse_matrix(path):
    """Parse matrix.yml and return OS list, toolchains, and exclusions."""
    with open(path, 'r') as f:
        data = yaml.safe_load(f)

    return {
        'os': data.get('os', []),
        'toolchain': data.get('toolchain', []),
        'exclude': data.get('exclude', [])
    }


def is_excluded(os_name, compiler, version, exclusions):
    """Check if a specific OS/compiler/version combination is excluded."""
    for exclusion in exclusions:
        exclude_os = exclusion.get('os')
        exclude_toolchain = exclusion.get('toolchain', {})
        exclude_compiler = exclude_toolchain.get('compiler')
        exclude_version = str(exclude_toolchain.get('version', ''))

        if exclude_os == os_name and exclude_compiler == compiler:
            # If exclusion doesn't specify version, it excludes all versions
            if not exclude_version or exclude_version == str(version):
                return True

    return False


def version_sort_key(version: str):
    """Convert version string to sortable tuple of integers."""
    # Handle versions like "13", "14", "2023.2", "0.57.0", etc.
    parts = str(version).replace("'", "").split('.')
    return tuple(int(p) if p.isdigit() else 0 for p in parts)


def get_latest(matrix: dict):
    """Find the latest supported version for each compiler/OS combination."""
    os_list = matrix['os']
    toolchains = matrix['toolchain']
    exclusions = matrix['exclude']

    # Group toolchains by compiler
    compilers = {}
    for toolchain in toolchains:
        compiler = toolchain['compiler']
        version = toolchain['version']
        if compiler not in compilers:
            compilers[compiler] = []
        compilers[compiler].append(version)

    # For each compiler, find latest version per OS
    latest_versions = {}
    for compiler, versions in compilers.items():
        latest_versions[compiler] = {}
        for os_name in os_list:
            # Find all non-excluded versions for this OS
            available = [
                v for v in versions
                if not is_excluded(os_name, compiler, v, exclusions)
            ]
            if available:
                # Sort and take the highest version
                latest = max(available, key=version_sort_key)
                latest_versions[compiler][os_name] = str(latest)

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
        print("Usage: update_latest_versions.py <matrix.yml> <output.env>")
        sys.exit(1)

    matrix_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not matrix_path.is_file():
        print(f"Error: {matrix_path} not found")
        sys.exit(1)

    matrix_data = parse_matrix(matrix_path)
    latest_versions = get_latest(matrix_data)
    variable_lines = to_lines(latest_versions)

    with open(output_path, 'w') as f:
        prefix_lines = [
            "# Auto-generated from .github/compat/matrix.yml",
            "# DO NOT EDIT MANUALLY - Run .github/compat/update_latest_versions.py to regenerate",
            "",
        ]
        f.write("\n".join(prefix_lines + variable_lines))

    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
