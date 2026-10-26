# SPDX-License-Identifier: LGPL-2.1-or-later

set -euf

dir=/run/cockpit/system-roles

umask 077
mkdir -p "$dir"
cat >"$dir/playbook.json"

cat >"$dir/run.sh" <<EOF
set -e
cd "$dir"
umask 077
echo "{\"_event\": \"cockpit_system_role_run_start\", \"arguments\": [\"\$@\"]}" >./run.out
export ANSIBLE_STDOUT_CALLBACK=ansible.posix.jsonl
ansible-playbook -i localhost, -c local "\$@" "./playbook.json" 2>"./run.err" >>"./run.out"
EOF

chmod a+x "$dir/run.sh"
