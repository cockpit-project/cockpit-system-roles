/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React, { useState } from 'react';
import { useDialogs, WithDialogs } from "dialogs";

import { Page, PageSection } from '@patternfly/react-core/dist/esm/components/Page/index.js';
import { Card, CardHeader, CardTitle, CardBody } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Table, Thead, Tbody, Tr, Th, Td, ExpandableRowContent } from '@patternfly/react-table';
import { Bullseye } from '@patternfly/react-core/dist/esm/layouts/Bullseye/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { EmptyState } from '@patternfly/react-core/dist/esm/components/EmptyState/index.js';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { TrashIcon } from '@patternfly/react-icons';

const _ = cockpit.gettext;

import { useAppConfig, AppConfig, Config, RoleConfig } from "./config";
import { AddRoleDialog } from "./discover";

const RoleRow = ({
    role,
    rowIndex,
    remove,
} : {
    role: RoleConfig,
    rowIndex: number,
    remove: () => void,
}) => {
    const [expanded, setExpanded] = useState<boolean>(false);

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
                <Td modifier="fitContent" hasAction>
                    <Button
                        onClick={remove}
                        icon={<TrashIcon />}
                        variant="plain"
                    />
                </Td>
            </Tr>
            <Tr isExpanded={expanded}>
                <Td colSpan={4}>
                    <ExpandableRowContent>
                        {role.vars.map(v => <div>{v.name}</div>)}
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

    function remove_role(role) {
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
                                key={r.name}
                                role={r}
                                rowIndex={i}
                                remove={() => remove_role(r)}
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
                    <Bullseye>
                        {_("Footer")}
                    </Bullseye>
                </PageSection>
            </Page>
        </WithDialogs>
    );
};
