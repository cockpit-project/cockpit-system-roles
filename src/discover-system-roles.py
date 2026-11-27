#! /usr/bin/python3
# SPDX-License-Identifier: LGPL-2.1-or-later

import glob
import json
import os
import sys

import yaml

# This program discovers all Linux System Roles and outputs a JSON
# blob.

def read_yaml(path):
    if os.path.exists(path):
        with open(path) as io:
            return yaml.safe_load(io)
    else:
        return None

def dump_yaml(val):
    return yaml.dump(val, default_flow_style=False).removesuffix("\n...\n")

# HACK - We need the default values rendered in YAML, but JavaScript
# currently doesn't have a YAML serializer, so we hackishly do it
# here.

def render_defaults(arguments):
    arg_specs = arguments.get("argument_specs")
    if arg_specs:
        for data in arg_specs.values():
            for spec in data["options"].values():
                if "default" in spec:
                    spec["default_yaml"] = dump_yaml(spec["default"])

def import_system_role (path):
    res = {
        "name": os.path.basename(path),
    }
    meta = read_yaml(os.path.join(path, "meta", "main.yml"))
    if meta:
        res["meta"] = meta
    arguments = read_yaml(os.path.join(path, "meta", "argument_specs.yml"))
    if arguments:
        render_defaults(arguments)
        res["arguments"] = arguments
    return res

roles = [ import_system_role(path) for path in glob.glob("/usr/share/ansible/roles/linux-system-roles.*") ]

sys.stdout.write(json.dumps({ "roles": roles }))
sys.stdout.write("\n")
