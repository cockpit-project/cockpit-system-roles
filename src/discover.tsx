/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from "cockpit";
import React, { useState } from "react";
import { useInit} from "hooks";
import * as python from "python";
import { useDialogs} from "dialogs";

import { Modal, ModalBody, ModalHeader, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner';
import { Button } from '@patternfly/react-core/dist/esm/components/Button';
import { Table, Thead, Tbody, Tr, Th, Td, ExpandableRowContent } from '@patternfly/react-table';

import { AppConfig, RoleConfig } from "./config";

import discover_system_roles_py from "./discover-system-roles.py";

const _ = cockpit.gettext;

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

export const AddRoleDialog = ({ config } : { config: AppConfig }) => {
    const Dialogs = useDialogs();

    const [roles, setRoles] = useState<SystemRole[] | null>(null)
    useInit(
        async () => {
            setRoles((await discover_system_roles()).roles);
        }
    );

    async function add_role(role: SystemRole) {
        try {
            const role_config: RoleConfig = {
                name: role.name,
                description: role.description || "",
                vars: Object.keys(role.arguments.main.options).map(o => ({ name: o, value: "" }))
            }
            await config.modify(conf => ({ ...conf, roles: [ ...conf.roles, role_config ] }));
            Dialogs.close();
        } catch (ex) {
            // XXX - put into dialog
            console.error(ex);
        }
    }

    let body;
    if (!roles)
        body = <Spinner />;
    else
        body = (
            <Table>
                <Tbody>
                    {
                        roles.map(
                            r => (
                                <Tr
                                    key={r.path}
                                    isClickable
                                    onRowClick={() => add_role(r)}
                                >
                                    <Td>{r.name}</Td>
                                    <Td>{r.description}</Td>
                                </Tr>
                            )
                        )
                    }
                </Tbody>
            </Table>
        );

    return (
        <Modal
            isOpen
            variant="medium"
            position="top"
            onClose={Dialogs.close}
        >
            <ModalHeader title="Add System Role" />
            <ModalBody>
                { body }
            </ModalBody>
        </Modal>
    );
}
