#! /usr/bin/python3
# SPDX-License-Identifier: LGPL-2.1-or-later

import json
import sys

import yaml

try:
    yaml.safe_load(sys.stdin)
except yaml.YAMLError as e:
    if isinstance(e, yaml.MarkedYAMLError):
        print(json.dumps({
            "context": {
                "message": e.context,
                "line": e.context_mark.line if e.context_mark else -1,
                "column": e.context_mark.column  if e.context_mark else -1,
            },
            "problem": {
                "message": e.problem,
                "line": e.problem_mark.line if e.problem_mark else -1,
                "column": e.problem_mark.column if e.problem_mark else -1,
            }
        }))
    else:
        print(json.dumps({}))
