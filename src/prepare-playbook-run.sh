# SPDX-License-Identifier: LGPL-2.1-or-later

set -euf

dir=/run/cockpit/system-roles

mkdir -p "$dir"
cat >"$dir/playbook.json"

cat >"$dir/run.sh" <<EOF
#/bin/sh

set -e
cd "$dir"
export ANSIBLE_STDOUT_CALLBACK=ansible.posix.jsonl
ansible-playbook -i localhost, -c local "./playbook.json" 2>"./run.err" >"./run.out"
EOF

chmod a+x "$dir/run.sh"
