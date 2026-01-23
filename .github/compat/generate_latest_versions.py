#!/usr/bin/env python3
"""
Generate latest-versions.sh from matrix.yml.
This creates a bash script with associative arrays mapping
runner OS to the latest supported version for each compiler.
"""

import sys
from pathlib import Path
import yaml


def parse_matrix(matrix_path):
    """Parse matrix.yml and return OS list, toolchains, and exclusions."""
    with open(matrix_path, 'r') as f:
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


def version_sort_key(version_str):
    """Convert version string to sortable tuple of integers."""
    # Handle versions like "13", "14", "2023.2", "0.57.0", etc.
    parts = str(version_str).replace("'", "").split('.')
    return tuple(int(p) if p.isdigit() else 0 for p in parts)


def find_latest_versions(matrix_data):
    """Find the latest supported version for each compiler/OS combination."""
    os_list = matrix_data['os']
    toolchains = matrix_data['toolchain']
    exclusions = matrix_data['exclude']

    # Group toolchains by compiler
    compilers = {}
    for toolchain in toolchains:
        compiler = toolchain['compiler']
        version = toolchain['version']
        if compiler not in compilers:
            compilers[compiler] = []
        compilers[compiler].append(version)

    # For each compiler, find latest version per OS
    result = {}
    for compiler, versions in compilers.items():
        result[compiler] = {}

        for os_name in os_list:
            # Find all non-excluded versions for this OS
            available_versions = [
                v for v in versions
                if not is_excluded(os_name, compiler, v, exclusions)
            ]

            if available_versions:
                # Sort and take the highest version
                latest = max(available_versions, key=version_sort_key)
                result[compiler][os_name] = str(latest)

    return result


def generate_bash_script(latest_versions):
    """Generate bash script content with latest version info in associative arrays."""
    lines = [
        "#!/usr/bin/env bash",
        "# Auto-generated from .github/compat/matrix.yml",
        "# DO NOT EDIT MANUALLY - Run .github/compat/generate_latest_versions.py to regenerate",
        "",
    ]

    for compiler, os_versions in sorted(latest_versions.items()):
        # Convert compiler name to valid bash variable name
        var_name = compiler.upper().replace('-', '_')

        lines.append(f"# Latest supported {compiler} versions by runner")
        lines.append(f"declare -A LATEST_{var_name}_VERSION")

        for os_name, version in sorted(os_versions.items()):
            lines.append(f'LATEST_{var_name}_VERSION["{os_name}"]="{version}"')

        lines.append("")

    return "\n".join(lines)


def main():
    if len(sys.argv) != 3:
        print("Usage: generate_latest_versions.py <matrix.yml> <output.sh>")
        sys.exit(1)

    matrix_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not matrix_path.is_file():
        print(f"Error: {matrix_path} not found")
        sys.exit(1)

    matrix_data = parse_matrix(matrix_path)
    latest_versions = find_latest_versions(matrix_data)
    bash_content = generate_bash_script(latest_versions)

    with open(output_path, 'w') as f:
        f.write(bash_content)

    print(f"Generated {output_path}")


if __name__ == "__main__":
    main()
