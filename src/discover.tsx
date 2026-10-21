/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from "cockpit";
import React, { useState, useEffect } from "react";
import * as python from "python";
import { useDialogs } from "dialogs";
import { basename } from "cockpit-path";

import { Modal, ModalBody, ModalHeader } from '@patternfly/react-core/dist/esm/components/Modal';
import { Table, Tbody, Tr, Td } from '@patternfly/react-table';

import { AppConfig, RoleConfig } from "./config";

import discover_system_roles_py from "./discover-system-roles.py";

export interface Option {
    type: string,
    description: string,
    default?: string,
    choices?: string[],
}

interface ArgumentSpecs {
    short_description?: string,
    description?: string,
    options: Record<string, Option>,
}

export interface SystemRole {
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

export const useSystemRoles = () => {
    const [roles, setRoles] = useState<SystemRole[] | Error | null>(null);

    useEffect(
        () => {
            async function doit() {
                try {
                    const result = await discover_system_roles();
                    setRoles(result.roles);
                } catch (ex) {
                    setRoles(new Error(String(ex)));
                }
            }

            doit();
        },
        [],
    );

    return roles;
};

export const AddRoleDialog = ({
    config,
    roles
} : {
    config: AppConfig,
    roles: SystemRole[],
}) => {
    const Dialogs = useDialogs();

    async function add_role(role: SystemRole) {
        try {
            const options = role.arguments?.main?.options;
            cockpit.assert(options);
            const role_config: RoleConfig = {
                name: role.name,
                full_name: basename(role.path),
                vars: {},
            };
            await config.modify(conf => ({ ...conf, roles: [...conf.roles, role_config] }));
            Dialogs.close();
        } catch (ex) {
            // XXX - error toast
            console.error(ex);
        }
    }

    const body = (
        <Table>
            <Tbody>
                {
                    roles
                            .filter(r => r.arguments?.main?.options)
                            .map(
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
};
