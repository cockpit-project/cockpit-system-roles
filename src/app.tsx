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
import { RhUiTrashIcon, RhUiExternalLinkIcon } from '@patternfly/react-icons';
import { Remarkable } from "remarkable";

const _ = cockpit.gettext;

import { useAppConfig, AppConfig, RoleConfig, VarConfig } from "./config";
import { useSystemRoles, SystemRole, AddRoleDialog } from "./discover";
import { PlaybookRunner } from "./run";
import { EditVariable } from "./edit";

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

const RoleRow = ({
    config,
    role,
    system_role,
    rowIndex,
} : {
    config: AppConfig,
    role: RoleConfig,
    system_role: SystemRole,
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
                <Td>{system_role.description}</Td>
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
                                    Object.entries(system_role.arguments?.main?.options || {}).map(
                                        ([name, sys_v]) => {
                                            const conf_v = role.vars[name];
                                            return (
                                                <Tr key={name}>
                                                    <Td modifier="fitContent">{shorten(name)}</Td>
                                                    <Td
                                                        width={30}
                                                        dangerouslySetInnerHTML={
                                                            {
                                                                __html: remarkable.render(sys_v.description)
                                                            }
                                                        }
                                                    />
                                                    <Td modifier="fitContent">{sys_v.type}</Td>
                                                    <Td>
                                                        <EditVariable
                                                            config={config}
                                                            role={role}
                                                            name={name}
                                                            spec={sys_v}
                                                        />
                                                    </Td>
                                                </Tr>
                                            );
                                        }
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

const ConfiguredRoles = ({
    config,
    roles,
} : {
    config: AppConfig
    roles: SystemRole[],
}) => {
    const Dialogs = useDialogs();

    function add_role() {
        Dialogs.show(<AddRoleDialog config={config} roles={roles} />);
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
                        (r, i) => {
                            const sys_r = roles.find(sr => sr.name == r.name); // XXX - use hashtable
                            return (
                                <RoleRow
                                    config={config}
                                    key={r.name}
                                    role={r}
                                    system_role={sys_r}
                                    rowIndex={i}
                                />
                            );
                        }
                    )
                }
            </Table>
        </Card>
    )
}

const MainSection = ({
    config,
    roles,
} : {
    config: AppConfig | Error | null,
    roles: SystemRole[] | Error | null,
}) => {
    if (!config || !roles)
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

    if (roles instanceof Error)
        return (
            <EmptyState>
                {cockpit.format(_("Can't load system roles: $0"), String(roles))}
            </EmptyState>
        );

    return <ConfiguredRoles config={config} roles={roles} />
}


export const Application = () => {
    const config = useAppConfig();
    const roles = useSystemRoles();

    return (
        <WithDialogs>
            <Page className='pf-m-no-sidebar'>
                <PageSection hasBodyWrapper={false}>
                    <Bullseye>
                        <h2>{_("Manage your system with Ansible and System Roles")}</h2>
                    </Bullseye>
                </PageSection>
                <PageSection hasBodyWrapper={false} isFilled hasOverflowScroll>
                    <MainSection config={config} roles={roles} />
                </PageSection>
                <PageSection hasBodyWrapper={false}>
                    { config instanceof AppConfig && <PlaybookRunner config={config} /> }
                </PageSection>
            </Page>
        </WithDialogs>
    );
};
