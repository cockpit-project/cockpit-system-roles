#! /usr/bin/python3
# SPDX-License-Identifier: LGPL-2.1-or-later

import glob
import json
import os
import sys
import yaml

# This program discovers all Linux System Roles and outputs a JSON
# blob.

def import_system_role (path):
    res = { "path": path }
    main_yml = os.path.join(path, "meta", "main.yml")
    if os.path.exists(main_yml):
        with open(main_yml) as io:
            meta = yaml.safe_load(io)
            res["meta"] = meta
            if meta["galaxy_info"]:
                res["name"] = meta["galaxy_info"].get("role_name")
                res["description"] = meta["galaxy_info"].get("description")
    args_yml = os.path.join(path, "meta", "argument_specs.yml")
    if os.path.exists(args_yml):
        with open(args_yml) as io:
            args = yaml.safe_load(io)
            res["arguments"] = args.get("argument_specs", None)
    if not res.get("name"):
        res["name"] = path.split(".")[-1]
    return res

roles = list(map(import_system_role, glob.glob("/usr/share/ansible/roles/linux-system-roles.*")))

sys.stdout.write(json.dumps({ "roles": roles }))
sys.stdout.write("\n")
