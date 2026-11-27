/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React, { useReducer, useState, useEffect } from 'react';
import { useInit } from "hooks";
import { LongRunningProcess, ProcessState } from "long-running-process";
import * as python from "python";

import { Table, Tbody, Tr, Td } from '@patternfly/react-table';
import { Card, CardHeader, CardTitle, CardBody } from '@patternfly/react-core/dist/esm/components/Card';
import { Button } from '@patternfly/react-core/dist/esm/components/Button';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner';
import { Label, LabelGroup, LabelColor, LabelStatus } from '@patternfly/react-core/dist/esm/components/Label';
import { Icon } from '@patternfly/react-core/dist/esm/components/Icon';
import { RhUiCheckIcon, RhUiMinusIcon, PlayIcon, StopIcon, StethoscopeIcon } from '@patternfly/react-icons';
import { EmptyState, EmptyStateBody } from '@patternfly/react-core/dist/esm/components/EmptyState';

import { toaster } from "./toaster";
import { AppConfig } from "./config";
import { run_debouncers_now, ExpandableTr, short_role_name, WithExcuse } from "./utils";
import { SystemRoles } from "./roles";
import { validate_all } from "./edit";

import prepare_playbook_run_py from "./prepare-playbook-run.py";

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

interface AnsibleEvent_CockpitRunFinish {
    _event: "cockpit_system_role_run_finish",
    exit_code: number,
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

type AnsibleEvent = AnsibleEvent_CockpitRunStart | AnsibleEvent_PlayStart | AnsibleEvent_TaskStart | AnsibleEvent_OK | AnsibleEvent_Skipped | AnsibleEvent_Failed | AnsibleEvent_Stats | AnsibleEvent_CockpitRunFinish;

enum RunState {
    empty,
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
    exit_code: null | number;
    state: RunState;
    stats: null | RunStats;
    plays: PlayRunData[];
}

function collate_ansible_events(events: AnsibleEvent[]) {
    const data: PlaybookRunData = { check_mode: false, exit_code: null, state: RunState.empty, stats: null, plays: [] };

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
            data.state = RunState.running;
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
        } else if (event._event === "cockpit_system_role_run_finish") {
            data.exit_code = event.exit_code;
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
    const [dataError, setDataError] = useState<unknown>(null);
    const [stderr, setStderr] = useState<string | null>(null);
    const [stderrError, setStderrError] = useState<unknown>(null);

    useEffect(
        () => {
            const stdout_file: cockpit.FileHandle<unknown> = cockpit.file(
                "/run/cockpit/system-roles/run.out",
                { syntax: JSONL, superuser: "try" }
            );

            stdout_file.watch(
                (events, _tag, error) => {
                    if (error) {
                        setData(null);
                        setDataError(error);
                    } else {
                        setData(collate_ansible_events(events ? events as AnsibleEvent[] : []));
                        setDataError(null);
                    }
                }
            );

            const stderr_file: cockpit.FileHandle<unknown> = cockpit.file(
                "/run/cockpit/system-roles/run.err",
                { superuser: "try" }
            );

            stderr_file.watch(
                (stderr, _tag, error) => {
                    if (error) {
                        setStderr(null);
                        setStderrError(error);
                    } else {
                        setStderr(stderr ? stderr as string : "");
                        setStderrError(null);
                    }
                }
            );

            return () => {
                stdout_file.close();
                stderr_file.close();
            };
        },
        []
    );

    return { data, dataError, stderr, stderrError };
};

function usePlaybookProcess() {
    const [, forceUpdate] = useReducer(x => x + 1, 0);
    return useInit(
        () => {
            return new LongRunningProcess(
                "cockpit-system-roles-runner.service",
                forceUpdate,
            );
        }
    );
}

interface PlaybookContext {
    check_mode: boolean,
    process_state: string,
}

const TaskState = ({
    context,
    state,
} : {
    context: PlaybookContext,
    state: RunState,
}) => {
    switch (state) {
    case RunState.running:
        if (context.process_state === ProcessState.RUNNING || context.process_state === ProcessState.INIT)
            return <Spinner isInline aria-valuetext={_("Running")} />;
        else
            return <Label status={LabelStatus.info} isCompact>{_("aborted")}</Label>;
    case RunState.failed:
        return <Label status={LabelStatus.danger} isCompact>{_("failed")}</Label>;
    case RunState.made_changes:
        return <Label status={LabelStatus.warning} isCompact>{_("changed")}</Label>;
    case RunState.skipped:
        return <Icon status="info"><RhUiMinusIcon /></Icon>;
    default:
        return <Icon status="success"><RhUiCheckIcon /></Icon>;
    }
};

const TaskRow = ({
    context,
    data,
} : {
    context: PlaybookContext,
    data: TaskRunData,
}) => {
    return (
        <>
            <div>
                {data.name}
                <div style={{ display: "inline-block", width: "0.5em" }} />
                <TaskState context={context} state={data.state} />
            </div>
            {data.messages.map((msg, index) => <div key={index}>- {msg}</div>)}
        </>
    );
};

const PlayState = ({
    context,
    state,
} : {
    context: PlaybookContext,
    state: RunState,
}) => {
    switch (state) {
    case RunState.running:
        if (context.process_state === ProcessState.RUNNING || context.process_state === ProcessState.INIT)
            return (
                <Label
                    variant="outline"
                    color={LabelColor.grey}
                    icon={<Spinner isInline aria-valuetext="" />}
                >
                    {_("Running")}
                </Label>
            );
        else
            return <Label variant="outline" status={LabelStatus.info}>{_("Aborted")}</Label>;
    case RunState.failed:
        return <Label variant="outline" status={LabelStatus.danger}>{_("Failed")}</Label>;
    case RunState.made_changes:
        return (
            <Label variant="outline" status={LabelStatus.warning}>
                {context.check_mode ? _("Changes needed") : _("Made changes")}
            </Label>
        );
    default:
        return <Label variant="outline" status={LabelStatus.success}>{_("Done")}</Label>;
    }
};

const PlayRow = ({
    context,
    data,
    rowIndex,
} : {
    context: PlaybookContext,
    data: PlayRunData
    rowIndex: number,
}) => {
    return (
        <ExpandableTr
            data-play={data.name}
            expandableContent={data.tasks.map((task_data, index) => <TaskRow key={index} context={context} data={task_data} />)}
            rowIndex={rowIndex}
        >
            <Td modifier="fitContent">
                <PlayState context={context} state={data.state} />
            </Td>
            <Td modifier="fitContent"><b>{short_role_name(data.name)}</b></Td>
            <Td>{data.running_task_name}</Td>
        </ExpandableTr>
    );
};

const PlaybookRunStats = ({
    context,
    data,
    stderr,
} : {
    context: PlaybookContext,
    data: PlaybookRunData,
    stderr: string,
}) => {
    let summary;
    switch (data.state) {
    case RunState.running:
        if (context.process_state === ProcessState.RUNNING || context.process_state === ProcessState.INIT)
            summary = <Label color={LabelColor.grey} icon={<Spinner isInline aria-valuetext="" />}>{_("Running")}</Label>;
        else if (data.exit_code === null)
            summary = <Label status={LabelStatus.info}>{_("Aborted")}</Label>;
        else
            summary = <Label status={LabelStatus.danger}>{_("Failed")}</Label>;
        break;
    case RunState.failed:
        summary = <Label status={LabelStatus.danger}>{_("Failed")}</Label>;
        break;
    case RunState.made_changes:
        summary = (
            <Label status={LabelStatus.warning}>
                {context.check_mode ? _("Changes need to be made") : _("Changes have been made")}
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

    let extra;
    if (data.stats) {
        extra = (
            <LabelGroup isCompact numLabels={4}>
                {stat_label(data.stats.failures, LabelStatus.danger, null, _("$0 failed"))}
                {stat_label(data.stats.changed, LabelStatus.warning, null, _("$0 changes"))}
                {stat_label(data.stats.ok, LabelStatus.success, <RhUiCheckIcon />, _("$0 ok"))}
                {stat_label(data.stats.skipped, LabelStatus.info, <RhUiMinusIcon />, _("$0 skipped"))}
            </LabelGroup>
        );
    } else if (data.exit_code !== null && data.exit_code > 0) {
        extra = (
            <>
                {cockpit.format(_("Exit code $0"), data.exit_code)}
                { stderr && <div>{stderr}</div> }
            </>
        );
    }

    return (
        <>
            {summary}
            <div style={{ display: "inline-block", width: "1em" }} />
            {extra}
        </>
    );
};

const PlaybookOutput = ({
    process,
    data,
    stderr,
} : {
    process: LongRunningProcess,
    data: PlaybookRunData
    stderr : string,
}) => {
    const context = {
        check_mode: data.check_mode,
        process_state: process.state,
    };

    if (data.state === RunState.empty) {
        return (
            <EmptyState>
                <EmptyStateBody>
                    {_("No previous playbook run")}
                </EmptyStateBody>
            </EmptyState>
        );
    }

    return (
        <Table isExpandable>
            <Tbody>
                <Tr>
                    <Td colSpan={4}>
                        <PlaybookRunStats context={context} data={data} stderr={stderr} />
                    </Td>
                </Tr>
            </Tbody>
            {data.plays.map((play_data, index) => <PlayRow key={index} context={context} data={play_data} rowIndex={index} />)}
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
    const { data, dataError, stderr, stderrError } = usePlaybookRunData();
    const process = usePlaybookProcess();

    const actions = <PlaybookRunner process={process} config={config} system_roles={system_roles} />;

    return (
        <Card id="playbook-execution">
            <CardHeader actions={{ actions }}>
                <CardTitle>{_("Playbook execution")}</CardTitle>
            </CardHeader>
            {
                !!(dataError || stderrError) &&
                    <CardBody>
                        {cockpit.format(_("Can't load playbook run data: $0"), String(dataError || stderrError))}
                    </CardBody>
            }
            { data !== null && stderr !== null && <PlaybookOutput process={process} data={data} stderr={stderr} /> }
        </Card>
    );
};

export const PlaybookRunner = ({
    process,
    config,
    system_roles,
} : {
    process: LongRunningProcess,
    config: AppConfig,
    system_roles: SystemRoles,
}) => {
    async function run({ dry } : { dry: boolean }) {
        try {
            await run_debouncers_now();
            if (!validate_all(config, system_roles))
                return;
            await python.spawn(prepare_playbook_run_py, [], { superuser: "require" }).input(JSON.stringify(config.config.roles));
            if (process.state === ProcessState.FAILED)
                process.reset();
            await process.run(["/bin/sh", "/run/cockpit/system-roles/run.sh", ...(dry ? ["--check"] : [])], {}, ["--collect"]);
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

    const valid = validate_all(config, system_roles);

    let run_excuse;
    if (!valid)
        run_excuse = _("Some system role parameters have invalid values.");
    else if (config.config.roles.length === 0)
        run_excuse = _("Add at least one system role to run the playbook");
    else if (config.config.roles.every(r => !r.enabled))
        run_excuse = _("Enable at least one system role to run the playbook");

    const can_run = process.state === ProcessState.STOPPED || process.state === ProcessState.FAILED;
    const can_stop = process.state === ProcessState.RUNNING;

    return (
        <>
            <WithExcuse
                id="playbook-run-excuse"
                excuse={run_excuse}
            >
                <Button
                    id="playbook-run"
                    aria-label={_("Run the playbook")}
                    onClick={() => run({ dry: false })}
                    isAriaDisabled={!!run_excuse || !can_run}
                    variant="plain"
                    icon={<PlayIcon />}
                />
            </WithExcuse>
            <WithExcuse
                id="playbook-check-excuse"
                excuse={run_excuse}
            >
                <Button
                    id="playbook-check"
                    aria-label={_("Run the playbook in 'check' mode")}
                    onClick={() => run({ dry: true })}
                    isAriaDisabled={!!run_excuse || !can_run}
                    variant="plain"
                    icon={<StethoscopeIcon />}
                />
            </WithExcuse>
            <Button
                id="playbook-stop"
                aria-label={_("Stop playbook run")}
                onClick={terminate}
                isAriaDisabled={!can_stop}
                variant="plain"
                icon={<StopIcon />}
            />
        </>
    );
};
