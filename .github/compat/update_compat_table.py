"""
Inserts Markdown compatibility tables
between tags in target Markdown file.
"""

import re
import sys
from pathlib import Path

compat_path = Path(sys.argv[1])  # path to Markdown table
update_path = Path(sys.argv[2])  # path to file to update

assert compat_path.is_file()
assert update_path.is_file()

with open(compat_path, "r") as compat:
    table = "".join(compat.readlines())
    r = re.compile(
        r"<!\-\- compat starts \-\->.*<!\-\- compat ends \-\->",
        re.DOTALL,
    )
    ct = "<!-- compat starts -->{}<!-- compat ends -->".format("\n{}\n".format(table))
    readme = update_path.open().read()
    update_path.open("w").write(r.sub(ct, readme))
