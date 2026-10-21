/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React from 'react';
import { useDialogs, WithDialogs } from "dialogs";
import { superuser } from "superuser";

import { Page, PageSection } from '@patternfly/react-core/dist/esm/components/Page';
import { Card, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card';
import { Table, Tbody, Tr, Td } from '@patternfly/react-table';
import { Bullseye } from '@patternfly/react-core/dist/esm/layouts/Bullseye';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner';
import { EmptyState } from '@patternfly/react-core/dist/esm/components/EmptyState';
import { Button } from '@patternfly/react-core/dist/esm/components/Button';
import { RhUiTrashIcon } from '@patternfly/react-icons';
import { Modal, ModalBody, ModalHeader } from '@patternfly/react-core/dist/esm/components/Modal';
import Markdown from "markdown-to-jsx";

import { shortenstart, ExternalLinkButton, ExpandableTr } from "./utils";
import { ToastArea } from "./toaster";
import { useAppConfig, AppConfig, RoleConfig, add_role, remove_role } from "./config";
import { useSystemRoles, SystemRole, SystemRoles, Option } from "./roles";
import { PlaybookOutput, PlaybookRunner } from "./run";
import { EditVariable } from "./edit";

const _ = cockpit.gettext;

superuser.reload_page_on_change();

const Description = ({
    children
} : {
    children: string | string[] | undefined
}) => {
    const options = {
        overrides: {
            a: {
                props: {
                    rel: "noopener noreferrer",
                    target: "_blank",
                },
            },
            // XXX - PatternFly messes with CSS so that for example
            // <ul> doesn't get bullets. We probably need to configure
            // Markdown to use PF text markup instead the standard
            // HTML one. Trying to undo PF CSS changes is the wrong
            // approach.
            ul: {
                props: {
                    style: { "list-style": "inside" },
                }
            }
        },
    };

    if (children) {
        return (
            <Markdown options={options}>
                { Array.isArray(children)
                    ? children.join("\n\n")
                    : children
                }
            </Markdown>
        );
    }
}

const VarRow = ({
    config,
    role,
    name,
    spec,
} : {
    config: AppConfig,
    role: RoleConfig,
    name: string,
    spec: Option,
}) => {
    return (
        <Tr key={name}>
            <Td modifier="fitContent">{name}</Td>
            <Td width={30}>
                <Description>{spec.description}</Description>
            </Td>
            <Td modifier="fitContent">{spec.type}</Td>
            <Td>
                <EditVariable
                    config={config}
                    role={role}
                    name={name}
                    spec={spec}
                />
            </Td>
        </Tr>
    );
};

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
    const expandableContent = (
        <Table>
            <Tbody>
                {
                    Object.entries(system_role.arguments?.argument_specs?.main?.options || {}).map(
                        ([name, spec]) => {
                            return (
                                <VarRow
                                    key={name}
                                    config={config}
                                    role={role}
                                    name={name}
                                    spec={spec}
                                />
                            );
                        }
                    )
                }
            </Tbody>
        </Table>
    );

    return (
        <ExpandableTr
            rowIndex={rowIndex}
            expandableContent={expandableContent}
        >
            <Td>{role.name}</Td>
            <Td>{system_role.meta?.galaxy_info?.description}</Td>
            <Td>
                <ExternalLinkButton
                    href={"https://linux-system-roles.github.io/" + shortenstart("linux-system-roles.", role.name)}
                    variant="link"
                >
                    {_("Documentation")}
                </ExternalLinkButton>
            </Td>
            <Td modifier="fitContent" hasAction>
                <Button
                    onClick={() => remove_role(config, role.name)}
                    icon={<RhUiTrashIcon />}
                    variant="plain"
                />
            </Td>
        </ExpandableTr>
    );
};

const AddRoleDialog = ({
    config,
    roles
} : {
    config: AppConfig,
    roles: SystemRoles,
}) => {
    const Dialogs = useDialogs();

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
                                            onRowClick={
                                                async () => {
                                                    await add_role(config, r.name);
                                                    Dialogs.close();
                                                }
                                            }
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

const ConfiguredRoles = ({
    config,
    roles,
} : {
    config: AppConfig
    roles: SystemRoles,
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
                            const sys_r = roles[r.name];
                            if (sys_r)
                                return (
                                    <RoleRow
                                        config={config}
                                        key={r.name}
                                        role={r}
                                        system_role={sys_r}
                                        rowIndex={i}
                                    />
                                );
                            else
                                return null;
                        }
                    )
                }
            </Table>
        </Card>
    );
};

const MainSection = ({
    config,
    roles,
} : {
    config: AppConfig | Error | null,
    roles: SystemRoles | Error | null,
}) => {
    if (superuser.allowed === false)
        return (
            <EmptyState>
                {_("Administrative access needed.")}
            </EmptyState>
        );

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

    return (
        <>
            <ConfiguredRoles config={config} roles={roles} />
            <PlaybookOutput />
        </>
    );
};

export const Application = () => {
    const config = useAppConfig();
    const roles = useSystemRoles();

    return (
        <WithDialogs>
            <ToastArea />
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
                    {
                        superuser.allowed && config instanceof AppConfig &&
                            <PlaybookRunner
                                config={config}
                            />
                    }
                </PageSection>
            </Page>
        </WithDialogs>
    );
};
