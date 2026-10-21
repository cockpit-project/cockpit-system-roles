/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2017 Red Hat, Inc.
 */

import React, { useState } from 'react';

import cockpit from 'cockpit';
import * as python from "python";
import { useInit} from "hooks";

import { Page, PageSection } from '@patternfly/react-core/dist/esm/components/Page/index.js';
import { Card, CardTitle, CardBody } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Table, Thead, Tbody, Tr, Th, Td, ExpandableRowContent } from '@patternfly/react-table';
import { Bullseye } from '@patternfly/react-core/dist/esm/layouts/Bullseye/index.js';

const _ = cockpit.gettext;

import discover_system_roles_py from "./discover-system-roles.py";

interface Option {
    type: string,
    description: string,
    default?: string,
    choices?: string[],
}

interface ArgumentSpecs {
    short_description?: string,
    description?: string,
    options: Record<string, Option>,
};

interface SystemRole {
    path: string,
    name: string,
    description: string | null,
    arguments: null | Record<string, ArgumentSpecs>,
    meta: unknown,
}

interface DiscoverResult {
    roles: SystemRole[];
}

async function discover_system_roles(): Promise<DiscoverResult> {
    return JSON.parse(await python.spawn(discover_system_roles_py, [], { superuser: "try" }));
}

const RoleRow = ({
    role,
    index,
} : {
    role: SystemRole,
    index: number,
}) => {
    const [expanded, setExpanded] = useState<boolean>(false);

    return (
        <Tbody isExpanded={expanded}>
            <Tr>
                <Td
                    expand={
                        {
                            rowIndex: index,
                            isExpanded: expanded,
                            onToggle: () => {
                                setExpanded(!expanded);
                            }
                        }
                    }
                />
                <Td>{role.name}</Td>
                <Td>{role.description}</Td>
            </Tr>
            <Tr isExpanded={expanded}>
                <Td colSpan={3}>
                    <ExpandableRowContent>
                        {role.arguments && Object.keys(role.arguments.main.options).join(", ")}
                    </ExpandableRowContent>
                </Td>
            </Tr>
        </Tbody>
    );
};

export const Application = () => {
    const [roles, setRoles] = useState<SystemRole[]>([])
    useInit(
        async () => {
            setRoles((await discover_system_roles()).roles);
        }
    );

    return (
        <Page className='pf-m-no-sidebar'>
            <PageSection hasBodyWrapper={false}>
                <Bullseye>
                    <h2>{_("Manage your system with Ansible and System Roles")}</h2>
                </Bullseye>
            </PageSection>
            <PageSection hasBodyWrapper={false} isFilled hasOverflowScroll>
                <Card>
                    <CardTitle>{_("Available System Roles")}</CardTitle>
                    <CardBody>
                        <Table isExpandable>
                            {
                                roles.map((r, i) => <RoleRow role={r} index={i} />)
                            }
                        </Table>
                    </CardBody>
                </Card>
            </PageSection>
            <PageSection hasBodyWrapper={false}>
                <Bullseye>
                    {_("Footer")}
                </Bullseye>
            </PageSection>
        </Page>
    );
};
