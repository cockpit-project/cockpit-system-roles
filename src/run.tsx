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
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner';
import { Label, LabelGroup, LabelColor, LabelStatus } from '@patternfly/react-core/dist/esm/components/Label';
import { Icon } from '@patternfly/react-core/dist/esm/components/Icon';
import { RhUiCheckIcon, RhUiMinusIcon, PlayIcon, StopIcon, StethoscopeIcon } from '@patternfly/react-icons';

import { toaster } from "./toaster";
import { AppConfig } from "./config";
import { run_debouncers_now, ExpandableTr, shortenstart, WithExcuse } from "./utils";
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
    arguments: string,
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

enum RunState {
    running,
    skipped,
    ok,
    made_changes,
    failed,
}

interface TaskRunData {
    name: string;
    state: RunState;
    messages: string[];
}

interface PlayRunData {
    name: string;
    state: RunState,
    tasks: TaskRunData[];
    running_task_name: string | undefined;
}

interface RunStats {
    changed: number,
    failures: number,
    ok: number,
    skipped: number,
}

interface PlaybookRunData {
    check_mode: boolean;
    state: RunState;
    stats: null | RunStats;
    plays: PlayRunData[];
}

function collate_ansible_events(events: AnsibleEvent[]) {
    const data: PlaybookRunData = { check_mode: false, state: RunState.running, stats: null, plays: [] };

    let running_play: string | null = null;
    let running_task: AnsibleEventTask | null = null;

    let tasks: TaskRunData[] = [];
    let tasks_changed: number = 0;
    let tasks_failed: number = 0;

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
            tasks.push({ name: running_task.name, state: RunState.running, messages: [] });
        if (running_play) {
            let state;
            if (running_task) {
                state = RunState.running;
            } else if (tasks_failed) {
                state = RunState.failed;
            } else if (tasks_changed) {
                state = RunState.made_changes;
            } else {
                state = RunState.ok;
            }

            data.plays.push({ name: running_play, state, tasks, running_task_name: running_task?.name });
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

    for (const event of events) {
        if (event._event === "cockpit_system_role_run_start") {
            data.check_mode = event.arguments.includes("--check");
        } else if (event._event === "v2_playbook_on_play_start") {
            start_play(event.play.name);
        } else if (event._event === "v2_playbook_on_task_start" || event._event === "v2_playbook_on_handler_task_start") {
            expect_no_running_task();
            running_task = event.task;
        } else if (event._event === "v2_runner_on_ok") {
            if (expect_running_task(event.task)) {
                running_task = null;
                let task: TaskRunData;
                if (event.hosts.localhost.changed) {
                    tasks_changed += 1;
                    task = { name: event.task.name, state: RunState.made_changes, messages: [] };
                } else {
                    task = { name: event.task.name, state: RunState.ok, messages: [] };
                }
                if (event.hosts.localhost.msg)
                    task.messages.push(event.hosts.localhost.msg);
                tasks.push(task);
            }
        } else if (event._event === "v2_runner_on_skipped") {
            if (expect_running_task(event.task)) {
                running_task = null;
                tasks.push({ name: event.task.name, state: RunState.skipped, messages: [] });
            }
        } else if (event._event === "v2_runner_on_failed") {
            if (expect_running_task(event.task)) {
                running_task = null;
                tasks_failed += 1;
                const task: TaskRunData = { name: event.task.name, state: RunState.failed, messages: [] };
                if (event.hosts.localhost.msg)
                    task.messages.push(event.hosts.localhost.msg);
                if (event.hosts.localhost.results) {
                    for (const res of event.hosts.localhost.results) {
                        if (res.failed)
                            task.messages.push(res.msg);
                    }
                }
                tasks.push(task);
            }
        } else if (event._event === "v2_playbook_on_stats") {
            expect_no_running_task();
            finish_play();

            data.stats = event.stats.localhost;
            if (data.stats.failures)
                data.state = RunState.failed;
            else if (data.stats.changed)
                data.state = RunState.made_changes;
            else
                data.state = RunState.ok;
        } else {
            console.warn(`Unexpected Ansible event sequence.  Event ${event._event} is unknown.`);
        }
    }

    finish_play();

    return data;
}

const JSONL = {
    parse: (val: string) => {
        return val.split("\n").slice(0, -1)
                .map(l => JSON.parse(l));
    }
};

export const usePlaybookRunData = () => {
    const [data, setData] = useState<PlaybookRunData | null>(null);
    const [error, setError] = useState<unknown>(null);

    useEffect(
        () => {
            const file: cockpit.FileHandle<unknown> = cockpit.file(
                "/run/cockpit/system-roles/run.out",
                { syntax: JSONL, superuser: "try" }
            );

            file.watch(
                (events, _tag, error) => {
                    if (error) {
                        setData(null);
                        setError(error);
                    } else {
                        setData(collate_ansible_events(events ? events as AnsibleEvent[] : []));
                        setError(null);
                    }
                }
            );
        },
        []
    );

    return { data, error };
};

const TaskState = ({
    state,
} : {
    state: RunState,
}) => {
    switch (state) {
    case RunState.running:
        return <Spinner isInline />;
    case RunState.failed:
        return <Label status={LabelStatus.danger} isCompact>{_("failed")}</Label>;
    case RunState.made_changes:
        return <Label status={LabelStatus.warning} isCompact>{_("changes")}</Label>;
    case RunState.skipped:
        return <Icon status="info"><RhUiMinusIcon /></Icon>;
    default:
        return <Icon status="success"><RhUiCheckIcon /></Icon>;
    }
};

const TaskRow = ({
    data,
} : {
    data: TaskRunData,
}) => {
    return (
        <>
            <div>
                {data.name}
                <div style={{ display: "inline-block", width: "0.5em" }} />
                <TaskState state={data.state} />
            </div>
            {data.messages.map((msg, index) => <div key={index}>- {msg}</div>)}
        </>
    );
};

const PlayState = ({
    state,
} : {
    state: RunState,
}) => {
    switch (state) {
    case RunState.running:
        return <Label variant="outline" color={LabelColor.grey} icon={<Spinner isInline />}>{_("Running")}</Label>;
    case RunState.failed:
        return <Label variant="outline" status={LabelStatus.danger}>{_("Failed")}</Label>;
    case RunState.made_changes:
        return <Label variant="outline" status={LabelStatus.warning}>{_("Made changes")}</Label>;
    default:
        return <Label variant="outline" status={LabelStatus.success}>{_("Done")}</Label>;
    }
};

const PlayRow = ({
    data,
    rowIndex,
} : {
    data: PlayRunData
    rowIndex: number,
}) => {
    return (
        <ExpandableTr
            data-play={data.name}
            expandableContent={data.tasks.map((task_data, index) => <TaskRow key={index} data={task_data} />)}
            rowIndex={rowIndex}
        >
            <Td modifier="fitContent">
                <PlayState state={data.state} />
            </Td>
            <Td modifier="fitContent"><b>{shortenstart("linux-system-roles.", data.name)}</b></Td>
            <Td>{data.running_task_name}</Td>
        </ExpandableTr>
    );
};

const PlaybookRunStats = ({
    data
} : {
    data: PlaybookRunData
}) => {
    let summary;
    switch (data.state) {
    case RunState.running:
        summary = <Label color={LabelColor.grey} icon={<Spinner isInline />}>{_("Running")}</Label>;
        break;
    case RunState.failed:
        summary = <Label status={LabelStatus.danger}>{_("Failed")}</Label>;
        break;
    case RunState.made_changes:
        summary = (
            <Label status={LabelStatus.warning}>
                {data.check_mode ? _("Changes need to be made") : _("Changes have been made")}
            </Label>
        );
        break;
    default:
        summary = <Label status={LabelStatus.success}>{_("Success")}</Label>;
        break;
    }

    function stat_label(n: number, status: LabelStatus, icon: React.ReactNode, fmt: string) {
        if (n)
            return (
                <Label
                    isCompact
                    variant="outline"
                    status={status}
                    icon={icon}
                >
                    {cockpit.format(fmt, n)}
                </Label>
            );
    }

    let stats;
    if (data.stats)
        stats = (
            <LabelGroup isCompact numLabels={4}>
                {stat_label(data.stats.failures, LabelStatus.danger, null, _("$0 failed"))}
                {stat_label(data.stats.changed, LabelStatus.warning, null, _("$0 changes"))}
                {stat_label(data.stats.ok, LabelStatus.success, <RhUiCheckIcon />, _("$0 ok"))}
                {stat_label(data.stats.skipped, LabelStatus.info, <RhUiMinusIcon />, _("$0 skipped"))}
            </LabelGroup>
        );

    return (
        <>
            {summary}
            <div style={{ display: "inline-block", width: "1em" }} />
            {stats}
        </>
    );
};

const PlaybookOutput = ({
    data
} : {
    data: PlaybookRunData
}) => {
    return (
        <Table isExpandable>
            <Tbody>
                <Tr>
                    <Td colSpan={4}>
                        <PlaybookRunStats data={data} />
                    </Td>
                </Tr>
            </Tbody>
            {data.plays.map((play_data, index) => <PlayRow key={index} data={play_data} rowIndex={index} />)}
        </Table>
    );
};

export const PlaybookExecution = ({
    config,
    system_roles,
} : {
    config: AppConfig,
    system_roles: SystemRoles,
}) => {
    const { data, error } = usePlaybookRunData();

    const actions = superuser.allowed && <PlaybookRunner config={config} system_roles={system_roles} />;

    return (
        <Card id="playbook-execution">
            <CardHeader actions={{ actions }}>
                <CardTitle>{_("Playbook execution")}</CardTitle>
            </CardHeader>
            {
                !!error &&
                    <CardBody>
                        {cockpit.format(_("Can't load playbook events: $0"), String(error))}
                    </CardBody>
            }
            { data && <PlaybookOutput data={data} /> }
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

    async function run({ dry } : { dry: boolean }) {
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
                <WithExcuse
                    id="playbook-run-excuse"
                    excuse={!valid && _("Some playbook variables have invalid values.")}
                >
                    <Button
                        id="playbook-run"
                        aria-label={_("Run the playbook")}
                        onClick={() => run({ dry: false })}
                        isAriaDisabled={!valid}
                        variant="plain"
                        icon={<PlayIcon />}
                    />
                </WithExcuse>
                <WithExcuse
                    id="playbook-run-excuse"
                    excuse={!valid && _("Some playbook variables have invalid values.")}
                >
                    <Button
                        id="playbook-check"
                        aria-label={_("Run the playbook in 'check' mode")}
                        onClick={() => run({ dry: true })}
                        isAriaDisabled={!valid}
                        variant="plain"
                        icon={<StethoscopeIcon />}
                    />
                </WithExcuse>
            </>
        );
    else if (process.state === ProcessState.RUNNING)
        actions = (
            <Button
                aria-label={_("Stop playbook run")}
                onClick={terminate}
                variant="plain"
                icon={<StopIcon />}
            />
        );

    return actions;
};
