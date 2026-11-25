#! /usr/bin/python3
# SPDX-License-Identifier: LGPL-2.1-or-later

import json
import os
import sys

import yaml

rundir = "/run/cockpit/system-roles"

roles = json.loads(sys.stdin.read())

class UnsafeString:
    def __init__(self, val):
        self.val = val
    def __repr__(self):
        return f"UnsafeString({self.val})"

def unsafe_string_representer(dumper, data):
    return dumper.represent_scalar("!unsafe", data.val)

yaml.add_representer(UnsafeString, unsafe_string_representer)

def make_value(var):
    val = yaml.safe_load(var["value"])
    # XXX - we mark all top-level strings as "!unsafe" to prevent
    # Jinja2 expansion.  We might want more control over when to do
    # this and when not.  Maybe we only want this for variables of
    # type "str" and never for "raw" even if the value happens to be a
    # string.  Also "!vault" is interesting.
    if isinstance(val, str):
        return UnsafeString(val)
    return val

def make_play(role):
    return {
        "hosts": "all",
        "name": role["name"],
        "vars": { name: make_value(var) for name, var in role["vars"].items() },
        "roles": [ role["name"] ],
    }

try:
    playbook = list(map(make_play, filter(lambda r: r["enabled"], roles)))
except yaml.YAMLError as err:
    sys.stderr.write(f"YAML error: {err}\n")
    exit(1)

os.umask(0o077)
os.makedirs(rundir, exist_ok=True)

with open(rundir + "/playbook.yml", "w") as io:
    yaml.dump(playbook, io, default_flow_style=False)

open(rundir + "/run.sh", "w").write(
    f"""
set -e
cd "{rundir}"
umask 077
echo "{{\\"_event\\": \\"cockpit_system_role_run_start\\", \\"arguments\\": \\"$@\\"}}" >./run.out
export ANSIBLE_STDOUT_CALLBACK=ansible.posix.jsonl
ansible-playbook -i localhost, -c local "$@" "./playbook.yml" 2>"./run.err" >>"./run.out"
""")

os.chmod(rundir + "/run.sh", 0o700)
