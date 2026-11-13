/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React, { useReducer, useState, useEffect, useRef } from 'react';
import { useInit } from "hooks";
import { LongRunningProcess, ProcessState } from "long-running-process";
import { superuser } from "superuser";

import { Table, Tbody, Tr, Td } from '@patternfly/react-table';
import { Card, CardHeader, CardTitle, CardBody } from '@patternfly/react-core/dist/esm/components/Card';
import { Button } from '@patternfly/react-core/dist/esm/components/Button';
import { Switch } from '@patternfly/react-core/dist/esm/components/Switch';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner';
import { Bullseye } from '@patternfly/react-core/dist/esm/layouts/Bullseye';
import { Flex, FlexItem } from '@patternfly/react-core/dist/esm/layouts/Flex';
import { Label, LabelColor, LabelStatus } from '@patternfly/react-core/dist/esm/components/Label';
import { Icon }from '@patternfly/react-core/dist/esm/components/Icon';
import { PlayIcon, StopIcon, StethoscopeIcon } from '@patternfly/react-icons';

import { toaster } from "./toaster";
import { AppConfig } from "./config";
import { run_debouncers_now, ExpandableTr, shortenstart } from "./utils";
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
                        setError(error);
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

function render_ansible_events(events: AnsibleEvent[], expected_plays: string[]) {
    let check_mode: boolean = false;

    interface PlayData {
        summary: React.ReactNode,
        tasks: React.ReactNode,
    };

    const plays = new Map<string, PlayData>();
    let running_play: string | null = null;
    let running_task: AnsibleEventTask | null = null;

    let tasks: React.ReactNode[] = [];
    let tasks_changed: number = 0;
    let tasks_failed: number = 0;
    let stats_row: React.ReactNode = null;

    function push_task(elt: React.ReactNode) {
        tasks.push(<div key={tasks.length}>{elt}</div>);
    }

    function expect_running_task(task: AnsibleEventTask) {
        if (running_task && running_task.id === task.id)
            return true;
        console.warn(`Unexpected Ansible event sequence.  Task ${task.name} had no starting event.`);
        return false;
    }

    function expect_no_running_task() {
        if (running_task) {
            console.warn(`Unexpected Ansible event sequence.  Task ${running_task.name} had no finishing event.`);
            running_task = null;
        }
    }

    function finish_play() {
        if (running_task)
            push_task(<>{running_task.name} <Spinner isInline /></>);
        if (running_play) {
            let summary;
            if (running_task)
                summary = <Label variant="outline" color={LabelColor.grey} icon={<Spinner isInline/>}>{_("Running")}</Label>;
            else if (tasks_failed)
                summary = <Label variant="outline" status={LabelStatus.danger}>{_("Failed")}</Label>;
            else if (tasks_changed)
                summary = <Label variant="outline" status={LabelStatus.warning}>{_("Made changes")}</Label>;
            else
                summary = <Label variant="outline" status={LabelStatus.success}>{_("Done")}</Label>;

            plays.set(running_play, { summary, tasks });
            running_play = null;
            tasks = [];
            tasks_changed = 0;
            tasks_failed = 0;
        }
    }

    function start_play(play: string) {
        expect_no_running_task();
        finish_play();
        running_play = play;
    }

    // HACK - avoids some flicker
    if (events.length < 2)
        return null;

    for (const event of events) {
        if (event._event === "cockpit_system_role_run_start") {
            check_mode = event.arguments.includes("--check");
        } else if (event._event === "v2_playbook_on_play_start") {
            start_play(event.play.name);
        } else if (event._event === "v2_playbook_on_task_start" || event._event === "v2_playbook_on_handler_task_start") {
            expect_no_running_task();
            running_task = event.task;
        } else if (event._event === "v2_runner_on_ok") {
            if (expect_running_task(event.task)) {
                running_task = null;
                if (event.hosts.localhost.changed) {
                    tasks_changed += 1;
                    push_task(<>{event.task.name} {check_mode ? _("CHANGES NEEDED") : _("CHANGED")}</>);
                    if (event.hosts.localhost.msg)
                        push_task(<>- {event.hosts.localhost.msg}</>);
                } else
                    push_task(<>{event.task.name} {_("(no change)")}</>);
            }
        } else if (event._event === "v2_runner_on_skipped") {
            if (expect_running_task(event.task)) {
                running_task = null;
                push_task(<>{event.task.name} {_("(skipped)")}</>);
            }
        } else if (event._event === "v2_runner_on_failed") {
            if (expect_running_task(event.task)) {
                running_task = null;
                tasks_failed += 1;
                push_task(<>{event.task.name} {_("FAILED")}</>);
                push_task(<>- {event.hosts.localhost.msg}</>);
                if (event.hosts.localhost.results) {
                    for (const res of event.hosts.localhost.results) {
                        if (res.failed)
                            push_task(<>- {res.msg}</>);
                    }
                }
            }
        } else if (event._event === "v2_playbook_on_stats") {
            expect_no_running_task();
            finish_play();
            const stats = event.stats.localhost;

            let summary;
            if (stats.failures)
                summary = <Label status={LabelStatus.danger}>{_("Failed")}</Label>;
            else if (stats.changed)
                summary = <Label status={LabelStatus.warning}>{_("Changes have been made")}</Label>;
            else
                summary = <Label status={LabelStatus.success}>{_("Success")}</Label>;

            function stat_label(n: number, color: LabelColor, fmt: string) {
                if (n)
                    return (
                        <Label
                            variant="outline"
                            color={color}
                        >
                            {cockpit.format(fmt, n)}
                        </Label>
                    );
            }

            stats_row = (
                <>
                    {summary}
                    {"\n"}
                    {stat_label(stats.failures, LabelColor.red, _("$0 failed"))}
                    {stat_label(stats.changed, LabelColor.yellow, _("$0 changes"))}
                    {stat_label(stats.skipped, LabelColor.blue, _("$0 skipped"))}
                    {stat_label(stats.ok, LabelColor.green, _("$0 ok"))}
                </>
            );
        } else {
            console.warn(`Unexpected Ansible event sequence.  Event ${event._event} is unknown.`);
        }
    }

    const running = !!running_play;
    finish_play();

    let rows = [];
    for (const play of expected_plays) {
        const data = plays.get(play);
        rows.push(
            <ExpandableTr
                key={rows.length}
                expandableContent={data ? data.tasks : null}
                rowIndex={rows.length}
            >
                <Td modifier="fitContent">
                    {
                        data
                            ? data.summary
                            : (
                                running
                                    ? null
                                    : <Label variant="outline" color={LabelColor.grey}>{_("Not applied")}</Label>
                            )
                    }
                </Td>
                <Td><b>{shortenstart("linux-system-roles.", play)}</b></Td>
            </ExpandableTr>
        );
    }

    return (
        <Table isExpandable>
            <Tbody>
                <Tr>
                    <Td colSpan={3}>
                        {stats_row || (running && <Label color={LabelColor.grey} icon={<Spinner isInline/>}>{_("Running")}</Label>)}
                    </Td>
                </Tr>
                {rows}
            </Tbody>
        </Table>
    );
}

export const PlaybookExecution = ({
    config,
    system_roles,
} : {
    config: AppConfig,
    system_roles: SystemRoles,
}) => {
    const { events, error } = useAnsibleEvents();

    const actions = superuser.allowed && <PlaybookRunner config={config} system_roles={system_roles} />;

    return (
        <Card id="playbook-output">
            <CardHeader actions={{ actions }}>
                <CardTitle>{_("Playbook execution")}</CardTitle>
            </CardHeader>
            { !!error &&
                <CardBody>
                    {cockpit.format(_("Can't load playbook events: $0"), String(error))}
                </CardBody>
            }
            { events && render_ansible_events(events, config.config.roles.map(r => r.name)) }
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
                            if (err)
                                toaster.add(_("Playbook execution failed"), err);
                        } catch (ex) {
                            toaster.add(_("Playbook execution failed"), cockpit.format(_("Can't access error: $0"), String(ex)));
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
        const roles = config.config.roles.filter(r => r.enabled);
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
    if (process.state === ProcessState.STOPPED)
        actions = (
            <>
                <Button
                    id="playbook-run"
                    onClick={() => run(false)}
                    isDisabled={!valid}
                    variant="plain"
                    icon={<PlayIcon />}
                />
                <Button
                    id="playbook-check"
                    onClick={() => run(true)}
                    isDisabled={!valid}
                    variant="plain"
                    icon={<StethoscopeIcon />}
                />
            </>
        );
    else if (process.state === ProcessState.RUNNING)
        actions = (
            <Button
                onClick={terminate}
                variant="plain"
                icon={<StopIcon />}
            />
        );

    return actions;
};
