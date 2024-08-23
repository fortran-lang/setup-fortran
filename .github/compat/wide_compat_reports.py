"""
Converts compatibility reports from long to wide format
and makes a Markdown table from the wide format report.
"""

from pathlib import Path
import pandas as pd
import sys

ip = Path(sys.argv[1])  # input file path
op = Path(sys.argv[2])  # output file path
assert ip.is_file()
assert ip.suffix == ".csv"
assert op.suffix == ".csv"

# read long CSV
df = pd.read_csv(ip)

# pivot and sort by runners
df = pd.pivot_table(
    df,
    index="runner",
    columns=["compiler", "version"],
    values="support",
    sort=True,
    aggfunc="first",
).sort_values(by=["runner"])


# group by compiler and sort by versions
grouped_versions = {}
for compiler in df.columns.get_level_values("compiler").unique():
    versions = df.loc[:, (compiler,)].columns.get_level_values("version").unique()
    versions = sorted(versions, key=lambda version: tuple(map(int, version.split("."))))
    grouped_versions[compiler] = versions

sorted_columns = []
for compiler in grouped_versions:
    sorted_columns.extend(
        [(compiler, version) for version in grouped_versions[compiler]]
    )

df = df[sorted_columns]

# write wide CSV
df.to_csv(op)

# write wide markdown table
with open(op.with_suffix(".md"), "w") as file:
    file.write(
        df.to_markdown()
        .replace("nan", "")
        .replace("(", "")
        .replace(")", "")
        .replace(",", "")
        .replace("'", "")
    )
