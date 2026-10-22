/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React, { useReducer, useState, useEffect, useRef } from 'react';
import { useInit } from "hooks";
import { LongRunningProcess, ProcessState } from "long-running-process";

import { Card, CardHeader, CardTitle, CardBody } from '@patternfly/react-core/dist/esm/components/Card';
import { Button } from '@patternfly/react-core/dist/esm/components/Button';
import { Switch } from '@patternfly/react-core/dist/esm/components/Switch';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner';
import { Bullseye } from '@patternfly/react-core/dist/esm/layouts/Bullseye';
import { Flex, FlexItem } from '@patternfly/react-core/dist/esm/layouts/Flex';

import { toaster } from "./toaster";
import { AppConfig } from "./config";
import { run_debouncers_now } from "./utils";
import { SystemRoles } from "./roles";
import { validate_all } from "./edit";

import prepare_playbook_run_sh from "./prepare-playbook-run.sh";

const _ = cockpit.gettext;

interface AnsibleEventPlay {
    id: string;
    name: string;
}

interface AnsibleEventTask {
    id: string;
    name: string;
}

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
}

interface AnsibleEvent_CockpitRunStart {
    _event: "cockpit_system_role_run_start",
    arguments: string[],
}

interface AnsibleEvent_PlayStart {
    _event: "v2_playbook_on_play_start",
    play: AnsibleEventPlay,
}

interface AnsibleEvent_TaskStart {
    _event: "v2_playbook_on_task_start" | "v2_playbook_on_handler_task_start",
    task: AnsibleEventTask,
}

interface AnsibleEvent_OK {
    _event: "v2_runner_on_ok",
    task: AnsibleEventTask,
    hosts: AnsibleEventHosts
}

interface AnsibleEvent_Skipped {
    _event: "v2_runner_on_skipped",
    task: AnsibleEventTask,
}

interface AnsibleEvent_Failed {
    _event: "v2_runner_on_failed",
    task: AnsibleEventTask,
    hosts: AnsibleEventHosts
}

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
}

type AnsibleEvent = AnsibleEvent_CockpitRunStart | AnsibleEvent_PlayStart | AnsibleEvent_TaskStart | AnsibleEvent_OK | AnsibleEvent_Skipped | AnsibleEvent_Failed | AnsibleEvent_Stats;

const JSONL = {
    parse: (val: string) => {
        return val.split("\n").slice(0, -1)
                .map(l => JSON.parse(l));
    }
};

export const useAnsibleEvents = () => {
    const [events, setEvents] = useState<AnsibleEvent[] | null>(null);
    const [error, setError] = useState<unknown>(null);

    useEffect(
        () => {
            const file: cockpit.FileHandle<unknown> = cockpit.file(
                "/run/cockpit/system-roles/run.out",
                { syntax: JSONL, superuser: "try" }
            );

            file.watch(
                (data, _tag, error) => {
                    if (error) {
                        setEvents(null);
                        setError(null);
                    } else {
                        setEvents(data ? data as AnsibleEvent[] : []);
                        setError(null);
                    }
                }
            );
        },
        []
    );

    return { events, error };
};

function render_ansible_events(events: AnsibleEvent[], show_all: boolean) {
    let check_mode: boolean = false;
    let running_task: AnsibleEventTask | null = null;
    const results: React.ReactNode[] = [];

    function push(elt: React.ReactNode) {
        results.push(<div key={results.length}>{elt}</div>);
    }

    for (const event of events) {
        if (event._event === "cockpit_system_role_run_start") {
            check_mode = event.arguments.includes("--check");
            if (check_mode)
                push(<i>{_("Drift check run")}</i>);
        } else if (event._event === "v2_playbook_on_play_start") {
            cockpit.assert(!running_task);
            push(<b>{event.play.name}</b>);
        } else if (event._event === "v2_playbook_on_task_start" || event._event === "v2_playbook_on_handler_task_start") {
            cockpit.assert(!running_task);
            running_task = event.task;
        } else if (event._event === "v2_runner_on_ok") {
            cockpit.assert(running_task && running_task.id === event.task.id);
            running_task = null;
            if (event.hosts.localhost.changed) {
                push(<>{event.task.name} {check_mode ? _("CHANGES NEEDED") : _("CHANGED")}</>);
                if (event.hosts.localhost.msg)
                    push(<>- {event.hosts.localhost.msg}</>);
            } else if (show_all)
                push(<>{event.task.name} {_("(no change)")}</>);
        } else if (event._event === "v2_runner_on_skipped") {
            cockpit.assert(running_task && running_task.id === event.task.id);
            running_task = null;
            if (show_all)
                push(<>{event.task.name} {_("(skipped)")}</>);
        } else if (event._event === "v2_runner_on_failed") {
            cockpit.assert(running_task && running_task.id === event.task.id);
            running_task = null;
            push(<>{event.task.name} {_("FAILED")}</>);
            push(<>- {event.hosts.localhost.msg}</>);
            if (event.hosts.localhost.results) {
                for (const res of event.hosts.localhost.results) {
                    if (res.failed)
                        push(<>- {res.msg}</>);
                }
            }
        } else if (event._event === "v2_playbook_on_stats") {
            cockpit.assert(!running_task);
            push(<br />);
            const stats = event.stats.localhost;
            if (stats.changed !== 0) {
                if (check_mode)
                    push(cockpit.format(_("$0 tasks have reported differences between the desired and the actual state of the machine."), stats.changed));
                else
                    push(cockpit.format(_("$0 tasks have made changes."), stats.changed));
            }
            if (stats.failures !== 0)
                push(cockpit.format(_("$0 tasks have failed."), stats.failures));
            if (stats.changed === 0 && stats.failures === 0) {
                if (check_mode)
                    push(_("The machine is in the desired state."));
                else
                    push(_("Nothing interesting has happened."));
            }
        }
    }

    if (running_task)
        push(<>{running_task.name} <Spinner isInline /></>);

    return results;
}

export const PlaybookOutput = () => {
    const [showAll, setShowAll] = useState(false);
    const { events, error } = useAnsibleEvents();

    const actions = (
        <Switch
            label={_("Show all execution steps")}
            isChecked={showAll}
            onChange={(_event, val) => setShowAll(val)}
        />
    );

    return (
        <Card id="playbook-output">
            <CardHeader actions={{ actions }}>
                <CardTitle>{_("Playbook execution")}</CardTitle>
            </CardHeader>
            <CardBody>
                { error ? cockpit.format(_("Can't load playbook events: $0"), String(error)) : null }
                { events && render_ansible_events(events, showAll) }
            </CardBody>
        </Card>
    );
};

export const PlaybookRunner = ({
    config,
    system_roles,
} : {
    config: AppConfig,
    system_roles: SystemRoles,
}) => {
    const previousState = useRef(ProcessState.INIT);
    const [, forceUpdate] = useReducer(x => x + 1, 0);
    const process = useInit(
        () => {
            return new LongRunningProcess(
                "cockpit-system-roles-runner.service",
                async (pr: LongRunningProcess) => {
                    forceUpdate();

                    const prev = previousState.current;
                    previousState.current = pr.state;

                    if (pr.state === ProcessState.FAILED && prev !== ProcessState.FAILED) {
                        try {
                            const err = await cockpit.file("/run/cockpit/system-roles/run.err", { superuser: "require" }).read();
                            toaster.add(_("Playbook execution failed"), err);
                        } catch (ex) {
                            toaster.add(_("Playbook execution failed"), cockpit.format(_("Can't access errror: $0"), String(ex)));
                        }
                        pr.reset();
                    }
                }
            );
        }
    );

    const valid = validate_all(config, system_roles);

    async function generate_playbook() {
        await run_debouncers_now();
        if (!validate_all(config, system_roles))
            return null;
        const roles = config.config.roles;
        return roles.map(
            role => {
                return {
                    name: role.name,
                    hosts: "all",
                    vars: (
                        Object.fromEntries(
                            Object.entries(role.vars)
                                    .filter(([, conf]) => !!conf.value)
                                    .map(([name, conf]) => [name, JSON.parse(conf.value)]))
                    ),
                    roles: [role.name],
                };
            }
        );
    }

    async function run(dry: boolean) {
        try {
            const playbook = await generate_playbook();
            if (!playbook)
                return;
            await cockpit.script(prepare_playbook_run_sh, [], { superuser: "require" }).input(JSON.stringify(playbook));
            if (process.state === ProcessState.FAILED)
                process.reset();
            await process.run(["/bin/sh", "/run/cockpit/system-roles/run.sh", ...(dry ? ["--check"] : [])], {});
        } catch (ex) {
            toaster.add_error(_("Failed to start the playbook"), ex);
        }
    }

    async function terminate() {
        try {
            await process.terminate();
        } catch (ex) {
            toaster.add_error(_("Failed to terminate the playbook"), ex);
        }
    }

    let actions;
    if (process.state === ProcessState.INIT)
        actions = <Spinner />;
    else if (process.state === ProcessState.STOPPED)
        actions = (
            <Flex>
                <FlexItem>
                    <Button
                        id="playbook-run"
                        onClick={() => run(false)}
                        variant="danger"
                        isDisabled={!valid}
                    >
                        {_("Apply the configuration to the local machine")}
                    </Button>
                </FlexItem>
                <FlexItem>
                    <Button
                        id="playbook-check"
                        onClick={() => run(true)}
                        variant="secondary"
                        isDisabled={!valid}
                    >
                        {_("Check whether any changes are necessary")}
                    </Button>
                </FlexItem>
            </Flex>
        );
    else if (process.state === ProcessState.RUNNING)
        actions = (
            <Button
                onClick={terminate}
            >
                {_("Stop")}
            </Button>
        );

    return (
        <Bullseye>
            {actions}
        </Bullseye>
    );
};
