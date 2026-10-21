/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React, { useState, useEffect, useRef } from 'react';
import { useDialogs, WithDialogs } from "dialogs";

import { Page, PageSection } from '@patternfly/react-core/dist/esm/components/Page';
import { Card, CardHeader, CardTitle, CardBody } from '@patternfly/react-core/dist/esm/components/Card';
import { Table, Tbody, Tr, Td, ExpandableRowContent } from '@patternfly/react-table';
import { Bullseye } from '@patternfly/react-core/dist/esm/layouts/Bullseye';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner';
import { EmptyState } from '@patternfly/react-core/dist/esm/components/EmptyState';
import { Button, ButtonProps } from '@patternfly/react-core/dist/esm/components/Button';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput';
import { RhUiTrashIcon, RhUiExternalLinkIcon } from '@patternfly/react-icons';
import { Remarkable } from "remarkable";

const _ = cockpit.gettext;

import { useAppConfig, AppConfig, RoleConfig, VarConfig } from "./config";
import { AddRoleDialog } from "./discover";
import { PlaybookRunner } from "./run";

const ExternalLinkButton = (props : ButtonProps) => (
    <Button
        component="a"
        icon={<RhUiExternalLinkIcon />}
        iconPosition="right"
        rel="noopener noreferrer"
        target="_blank"
        {...props}
    />
);

const DebouncedTextInput = ({
    value,
    onChange,
} : {
    value: string,
    onChange: (val: string) => void,
}) => {
    const [localValue, setLocalValue] = useState<string>(value);
    const timer = useRef<number>(0);

    useEffect(
        () => {
            setLocalValue(value);
        },
        [value],
    )

    return (
        <TextInput
            value={localValue}
            onChange={
                (_event, val) => {
                    setLocalValue(val);
                    if (timer.current)
                        window.clearTimeout(timer.current);
                    timer.current = window.setTimeout(
                        () => {
                            timer.current = 0;
                            onChange(val);
                        },
                        500);
                }
            }
        />
    )
}

const RoleRow = ({
    config,
    role,
    rowIndex,
} : {
    config: AppConfig,
    role: RoleConfig,
    rowIndex: number,
}) => {
    const [expanded, setExpanded] = useState<boolean>(false);

    function remove_role() {
        try {
            config.modify(
                conf => {
                    return {
                        ...conf,
                        roles: conf.roles.filter(r => !Object.is(r, role))
                    };
                }
            );
        } catch (ex) {
            // XXX - error toast
            console.log("Failed to remove", ex);
        }
    }

    function update_variable(variable: VarConfig, value: string) {
        try {
            config.modify(
                conf => {
                    return {
                        ...conf,
                        roles: conf.roles.map(
                            r =>
                                Object.is(r, role)
                                    ?
                                    { ...r,
                                        vars: r.vars.map(
                                            v =>
                                                Object.is(v, variable)
                                                    ?
                                                    {
                                                        ...v,
                                                        value,
                                                    }
                                                    : v
                                        )
                                    }
                                    : r
                        )
                    };
                }
            );
        } catch (ex) {
            // XXX - error toast
            console.log("Failed to update", ex);
        }
    }

    function shorten(name: string): string {
        if (name.startsWith(role.name + "_"))
            return name.substring(role.name.length + 1);
        return name;
    }

    const remarkable = new Remarkable();

    return (
        <Tbody isExpanded={expanded}>
            <Tr>
                <Td
                    expand={
                        {
                            rowIndex,
                            isExpanded: expanded,
                            onToggle: () => {
                                setExpanded(!expanded);
                            }
                        }
                    }
                />
                <Td>{role.name}</Td>
                <Td>{role.description}</Td>
                <Td>
                    <ExternalLinkButton
                        href={"https://linux-system-roles.github.io/" + role.name}
                        variant="link"
                    >
                        {_("Documentation")}
                    </ExternalLinkButton>
                </Td>
                <Td modifier="fitContent" hasAction>
                    <Button
                        onClick={remove_role}
                        icon={<RhUiTrashIcon />}
                        variant="plain"
                    />
                </Td>
            </Tr>
            <Tr isExpanded={expanded}>
                <Td colSpan={5}>
                    <ExpandableRowContent>
                        <Table>
                            <Tbody>
                                {
                                    role.vars.map(
                                        v => (
                                            <Tr key={v.name}>
                                                <Td modifier="fitContent">{shorten(v.name)}</Td>
                                                <Td
                                                    width={30}
                                                    dangerouslySetInnerHTML={
                                                        {
                                                            __html: remarkable.render(v.description)
                                                        }
                                                    }
                                                />
                                                <Td modifier="fitContent">{v.type}</Td>
                                                <Td>
                                                    <DebouncedTextInput
                                                        value={v.value}
                                                        onChange={val => update_variable(v, val)}
                                                    />
                                                </Td>
                                            </Tr>
                                        )
                                    )
                                }
                            </Tbody>
                        </Table>
                    </ExpandableRowContent>
                </Td>
            </Tr>
        </Tbody>
    );
};

const ConfiguredRoles = ({ config } : { config: AppConfig }) => {
    const Dialogs = useDialogs();

    function add_role() {
        Dialogs.show(<AddRoleDialog config={config} />);
    }

    const actions = (
        <Button onClick={add_role}>
            {_("Add System Role")}
        </Button>
    );

    return (
        <Card>
            <CardHeader actions={{ actions }}>
                <CardTitle>{_("Configured System Roles")}</CardTitle>
            </CardHeader>
            <Table isExpandable>
                {
                    config.config.roles.map(
                        (r, i) => (
                            <RoleRow
                                config={config}
                                key={r.name}
                                role={r}
                                rowIndex={i}
                            />
                        )
                    )
                }
            </Table>
        </Card>
    )
}

const MainSection = ({ config } : { config: AppConfig | Error | null }) => {
    if (!config)
        return (
            <Bullseye>
                <Spinner />
            </Bullseye>
        );

    if (config instanceof Error)
        return (
            <EmptyState>
                {cockpit.format(_("Can't load configuration: $0"), String(config))}
            </EmptyState>
        );

    return <ConfiguredRoles config={config} />
}


export const Application = () => {
    const config = useAppConfig();

    return (
        <WithDialogs>
            <Page className='pf-m-no-sidebar'>
                <PageSection hasBodyWrapper={false}>
                    <Bullseye>
                        <h2>{_("Manage your system with Ansible and System Roles")}</h2>
                    </Bullseye>
                </PageSection>
                <PageSection hasBodyWrapper={false} isFilled hasOverflowScroll>
                    <MainSection config={config} />
                </PageSection>
                <PageSection hasBodyWrapper={false}>
                    { config instanceof AppConfig && <PlaybookRunner config={config} /> }
                </PageSection>
            </Page>
        </WithDialogs>
    );
};
