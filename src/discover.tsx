/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from "cockpit";
import React, { useState, useEffect } from "react";
import * as python from "python";
import { useDialogs } from "dialogs";

import { Modal, ModalBody, ModalHeader } from '@patternfly/react-core/dist/esm/components/Modal';
import { Table, Tbody, Tr, Td } from '@patternfly/react-table';

import { toaster } from "./toaster";
import { AppConfig, RoleConfig } from "./config";

import discover_system_roles_py from "./discover-system-roles.py";

const _ = cockpit.gettext;

export interface Option {
    type?: string,
    description?: string,
    default?: string,
    choices?: string[],
}

interface ArgumentSpecs {
    short_description?: string,
    description?: string,
    options?: Record<string, Option>,
}

interface Meta {
    galaxy_info?: {
        description?: string;
    }
}

export interface SystemRole {
    name: string,
    meta: null | Meta,
    arguments: null | {
        argument_specs: Record<string, ArgumentSpecs>,
    },
}

interface DiscoverResult {
    roles: SystemRole[];
}

async function discover_system_roles(): Promise<DiscoverResult> {
    return JSON.parse(await python.spawn(discover_system_roles_py, [], { superuser: "try" }));
}

export type SystemRoles = Record<string, SystemRole>;

export const useSystemRoles = () => {
    const [roles, setRoles] = useState<SystemRoles | Error | null>(null);

    useEffect(
        () => {
            async function doit() {
                try {
                    const result = await discover_system_roles();
                    setRoles(Object.fromEntries(result.roles.map(r => [r.name, r])));
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
    roles: SystemRoles,
}) => {
    const Dialogs = useDialogs();

    async function add_role(role: SystemRole) {
        try {
            const options = role.arguments?.argument_specs?.main?.options;
            cockpit.assert(options);
            const role_config: RoleConfig = {
                name: role.name,
                vars: {},
            };
            await config.modify(conf => ({ ...conf, roles: [...conf.roles, role_config] }));
        } catch (ex) {
            toaster.add_error(_("Failed to add role"), ex);
        }
        Dialogs.close();
    }

    console.log("R", Object.values(roles));

    const body = (
        <Table>
            <Tbody>
                {
                    Object.values(roles)
                            .filter(r => r.arguments?.argument_specs?.main?.options)
                            .map(
                                r => {
                                    return (
                                        <Tr
                                        key={r.name}
                                        isClickable
                                        onRowClick={() => add_role(r)}
                                        >
                                            <Td>{r.name}</Td>
                                            <Td>{r.meta?.galaxy_info?.description}</Td>
                                        </Tr>
                                    );
                                }
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
