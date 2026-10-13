/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React, { useReducer, useState } from 'react';
import { useInit, useFile } from "hooks";
import { LongRunningProcess, ProcessState } from "long-running-process";

import { Card, CardHeader, CardTitle, CardBody } from '@patternfly/react-core/dist/esm/components/Card';
import { Button } from '@patternfly/react-core/dist/esm/components/Button';
import { Switch } from '@patternfly/react-core/dist/esm/components/Switch';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner';

import { AppConfig } from "./config";

import prepare_playbook_run_sh from "./prepare-playbook-run.sh";

const _ = cockpit.gettext;

const JSONL = {
    parse: (val: string) => {
        return val.split("\n").filter(l => !!l).map(l => JSON.parse(l));
    }
};

interface AnsibleEventPlay {
    id: string;
    name: string;
};

interface AnsibleEventTask {
    id: string;
    name: string;
};

interface AnsibleEventHosts {
    localhost: {
        changed: boolean;
        failed: boolean;
        msg: string,
        results?: {
            failed: boolean,
            msg: string,
        }[],
    }
};

interface AnsibleEvent_PlayStart {
    _event: "v2_playbook_on_play_start",
    play: AnsibleEventPlay,
};

interface AnsibleEvent_TaskStart {
    _event: "v2_playbook_on_task_start" | "v2_playbook_on_handler_task_start",
    task: AnsibleEventTask,
};

interface AnsibleEvent_OK {
    _event: "v2_runner_on_ok",
    task: AnsibleEventTask,
    hosts: AnsibleEventHosts
};

interface AnsibleEvent_Skipped {
    _event: "v2_runner_on_skipped",
    task: AnsibleEventTask,
};

interface AnsibleEvent_Failed {
    _event: "v2_runner_on_failed",
    task: AnsibleEventTask,
    hosts: AnsibleEventHosts
};

interface AnsibleEvent_Stats {
    _event: "v2_playbook_on_stats",
    stats: {
        localhost: {
            changed: number,
            failures: number,
            ignored: number,
            ok: number,
            rescued: number,
            skipped: number,
            unreachable: number,
        }
    }
};

type AnsibleEvent = AnsibleEvent_PlayStart | AnsibleEvent_TaskStart | AnsibleEvent_OK | AnsibleEvent_Skipped | AnsibleEvent_Failed | AnsibleEvent_Stats;

function render_ansible_events(events: AnsibleEvent[], show_all: boolean) {
    let running_task: AnsibleEventTask | null = null;
    let results = [];

    console.log("EVENTS", events);

    for (const event of events) {
        if (event._event == "v2_playbook_on_play_start") {
            cockpit.assert(!running_task);
            results.push(<div><b>{event.play.name}</b></div>);
        } else if (event._event == "v2_playbook_on_task_start" || event._event == "v2_playbook_on_handler_task_start") {
            cockpit.assert(!running_task);
            running_task = event.task;
        } else if (event._event == "v2_runner_on_ok") {
            cockpit.assert(running_task && running_task.id == event.task.id);
            running_task = null;
            if (event.hosts.localhost.changed)
                results.push(<div>{event.task.name} {_("CHANGED")}</div>);
            else if (show_all)
                results.push(<div>{event.task.name} {_("(no change)")}</div>);
        } else if (event._event == "v2_runner_on_skipped") {
            cockpit.assert(running_task && running_task.id == event.task.id);
            running_task = null;
            if (show_all)
                results.push(<div>{event.task.name} {_("(skipped)")}</div>);
        } else if (event._event == "v2_runner_on_failed") {
            cockpit.assert(running_task && running_task.id == event.task.id);
            running_task = null;
            results.push(<div>{event.task.name} {_("FAILED")}</div>);
            results.push(<div>- {event.hosts.localhost.msg}</div>);
            if (event.hosts.localhost.results) {
                for (const res of event.hosts.localhost.results) {
                    if (res.failed)
                        results.push(<div>- {res.msg}</div>);
                }
            }
        } else if (event._event == "v2_playbook_on_stats") {
            cockpit.assert(!running_task);
            results.push(<div>{JSON.stringify(event.stats.localhost)}</div>);
        }
    }

    if (running_task)
        results.push(<div>{running_task.name} <Spinner isInline/></div>);

    return results;
}

export const PlaybookRunner = ({
    config,
} : {
    config: AppConfig,
}) => {
    const [, forceUpdate] = useReducer(x => x + 1, 0);
    const process = useInit(() => new LongRunningProcess("cockpit-system-roles-runner.service", forceUpdate));

    // XXX - hand code this to get the types correct?
    const output: AnsibleEvent[] = useFile("/run/cockpit/system-roles/run.out", { superuser: "try", syntax: JSONL });
    const error_output: string | false | null = useFile("/run/cockpit/system-roles/run.err", { superuser: "try" });

    const [showAll, setShowAll] = useState<boolean>(false);

    function generate_playbook() {
        const roles = config.config.roles;
        return roles.map(
            role => {
                return {
                    name: role.description,
                    hosts: "all",
                    vars: Object.fromEntries(role.vars.filter(v => v.value).map(v => [v.name, JSON.parse(v.value)])),
                    roles: [ role.full_name ],
                }
            }
        );
    }

    async function run() {
        try {
            const playbook = generate_playbook();
            await cockpit.script(prepare_playbook_run_sh, [], { superuser: "require" }).input(JSON.stringify(playbook));
            process.run([ "/bin/sh", "/run/cockpit/system-roles/run.sh" ], {});
        } catch (ex) {
            // XXX - error toast
            console.log("Can't run", ex);
        }
    }

    async function terminate() {
        try {
            await process.terminate();
        } catch (ex) {
            // XXX - error toast
            console.log("Can't terminate", ex);
        }
    }

    async function reset() {
        try {
            await cockpit.spawn(["rm", "-f", "/run/cockpit/system-roles/run.err"], { superuser: "require" });
            process.reset();
        } catch (ex) {
            // XXX - error toast
            console.log("Can't reset", ex);
        }
    }

    let actions;
    if (process.state == ProcessState.INIT)
        actions = <Spinner />;
    else if (process.state == ProcessState.STOPPED)
        actions = (
            <>
                {_("Idle")}
                {"\n"}
                <Button
                    onClick={run}
                >
                    {_("Run")}
                </Button>
            </>
        );
    else if (process.state == ProcessState.RUNNING)
        actions = (
            <>
                {cockpit.format(_("Running since $0"), process.startTimestamp)}
                {"\n"}
                <Button
                    onClick={terminate}
                >
                    {_("Stop")}
                </Button>
            </>
        );
    else if (process.state == ProcessState.FAILED)
        actions = (
            <>
                {_("Failed")}
                {"\n"}
                <Button
                    onClick={reset}
                >
                    {_("Reset")}
                </Button>
            </>
        );

    return (
        <Card>
            <CardHeader>
                <CardTitle>{_("Playbook execution")}</CardTitle>
            </CardHeader>
            <CardBody>
                {output && render_ansible_events(output, showAll)}
                <br />
                <Switch
                    label={_("Show all execution steps")}
                    isChecked={showAll}
                    onChange={(_event, val) => setShowAll(val)}
                />
            </CardBody>
            <CardBody>
                {error_output}
            </CardBody>
            <CardBody>
                {actions}
            </CardBody>
        </Card>
    );
}
