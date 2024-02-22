import csv
import json
import sys
from pathlib import Path

csv_path = Path(sys.argv[1])  # path to CSV file
jsn_path = Path(sys.argv[2])  # path to JSON file

include = []

with open(csv_path, "r") as csv_file:
    reader = csv.DictReader(csv_file)
    for row in reader:
        if not any(row["support"].strip()):
            continue
        include.append(
            {
                "os": row["runner"],
                "toolchain": {"compiler": row["compiler"], "version": row["version"]},
            }
        )

with open(jsn_path, "w") as jsn_file:
    json.dump({"include": include}, jsn_file)
