#! /usr/bin/python3
# SPDX-License-Identifier: LGPL-2.1-or-later

import glob
import json
import os
import sys

import yaml

# This program discovers all Linux System Roles and outputs a JSON
# blob.

def read_yaml (path):
    if os.path.exists(path):
        with open(path) as io:
            return yaml.safe_load(io)
    else:
        return None

def import_system_role (path):
    return {
        "name": os.path.basename(path),
        "meta": read_yaml(os.path.join(path, "meta", "main.yml")),
        "arguments": read_yaml(os.path.join(path, "meta", "argument_specs.yml")),
    }

roles = [ import_system_role(path) for path in glob.glob("/usr/share/ansible/roles/linux-system-roles.*") ]

sys.stdout.write(json.dumps({ "roles": roles }))
sys.stdout.write("\n")
