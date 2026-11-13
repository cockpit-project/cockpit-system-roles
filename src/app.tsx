/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React, { useState } from 'react';
import { useDialogs, WithDialogs } from "dialogs";
import { superuser } from "superuser";

import { Page, PageSection } from '@patternfly/react-core/dist/esm/components/Page';
import { Card, CardHeader, CardTitle, CardBody } from '@patternfly/react-core/dist/esm/components/Card';
import { Table, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { Bullseye } from '@patternfly/react-core/dist/esm/layouts/Bullseye';
import { Split, SplitItem } from '@patternfly/react-core/dist/esm/layouts/Split';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner';
import { EmptyState } from '@patternfly/react-core/dist/esm/components/EmptyState';
import { Button } from '@patternfly/react-core/dist/esm/components/Button';
import { RhUiTrashIcon } from '@patternfly/react-icons';
import { Modal, ModalBody, ModalHeader } from '@patternfly/react-core/dist/esm/components/Modal';
import { Switch } from '@patternfly/react-core/dist/esm/components/Switch';
import { DropdownItem } from '@patternfly/react-core/dist/esm/components/Dropdown';

import Markdown from "markdown-to-jsx";

import { shortenstart, KebabMenu } from "./utils";
import { ToastArea } from "./toaster";
import { useAppConfig, AppConfig, RoleConfig, add_role, remove_role, enable_role } from "./config";
import { useSystemRoles, SystemRole, SystemRoles, Option } from "./roles";
import { PlaybookExecution } from "./run";
import { EditVariable } from "./edit";

const _ = cockpit.gettext;

superuser.reload_page_on_change();

const Description = ({
    max_length,
    children
} : {
    max_length?: number,
    children: string | string[] | undefined
}) => {
    const [showAll, setShowAll] = useState(false);

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
            // Markdown to use PF text markup instead of the standard
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
        const text = Array.isArray(children) ? children.join("\n\n") : children;
        let displayed_text;
        let show_more_button = false;
        let show_less_button = false;
        if (max_length && text.length > max_length) {
            if (!showAll) {
                displayed_text = text.substring(0, max_length - 5) + "...";
                show_more_button = true;
            } else {
                displayed_text = text;
                show_less_button = true;
            }
        } else {
            displayed_text = text;
        }
        return (
            <>
                <Markdown options={options}>
                    { displayed_text }
                </Markdown>
                {
                    show_more_button &&
                        <>
                            {"\n"}
                            <Button
                                isInline
                                variant="link"
                                onClick={() => setShowAll(true)}
                            >
                                {_("Show more")}
                            </Button>
                        </>
                }
                {
                    show_less_button &&
                        <Button
                            isInline
                            variant="link"
                            onClick={() => setShowAll(false)}
                        >
                            {_("Show less")}
                        </Button>
                }
            </>
        );
    }
};

const AddRoleDialog = ({
    config,
    roles,
    filter,
} : {
    config: AppConfig,
    roles: SystemRoles,
    filter: (role: SystemRole) => boolean,
}) => {
    const Dialogs = useDialogs();

    const body = (
        <Table>
            <Tbody>
                {
                    Object.values(roles)
                            .filter(r => r.arguments?.argument_specs?.main?.options)
                            .filter(filter)
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
            id="add-role-modal"
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
    const short_role_name = shortenstart("linux-system-roles.", role.name);
    return (
        <div data-var={name}>
            <div style={{ marginBlockStart: "0.5em", borderBlockStart: "solid grey 1px" }} />
            <div style={{ marginBlockStart: "0.5em" }}>
                <b>{shortenstart(short_role_name + "_", name)}</b> ({spec.type})
            </div>
            <div style={{ marginBlockStart: "0.5em" }}>
                <EditVariable
                    config={config}
                    role={role}
                    name={name}
                    spec={spec}
                />
            </div>
            <div style={{ marginBlock: "0.5em" }}>
                <Description max_length={500}>
                    {spec.description}
                </Description>
            </div>
        </div>
    );
};

const RolePanel = ({
    config,
    role,
    system_role,
} : {
    config: AppConfig,
    role: RoleConfig,
    system_role: SystemRole,
}) => {
    return (
        <>
            <h3>
                {shortenstart("linux-system-roles.", role.name)}
            </h3>
            <Description>
                {system_role.meta?.galaxy_info?.description}
            </Description>
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
        </>
    );
};

const RoleRow = ({
    config,
    role,
    isSelected,
    onSelect,
} : {
    config: AppConfig,
    role: RoleConfig,
    isSelected: boolean,
    onSelect: () => void,
}) => {
    return (
        <Tr
            isSelectable
            isClickable
            isRowSelected={isSelected}
            data-role={role.name}
        >
            <Td modifier="fitContent">
                <Switch
                    isChecked={!!role.enabled}
                    onChange={
                        (_event, val) => {
                            enable_role(config, role.name, val);
                        }
                    }
                />
            </Td>
            <Td
                onClick={onSelect}
            >
                <b>{shortenstart("linux-system-roles.", role.name)}</b>
            </Td>
            <Td modifier="fitContent" hasAction>
                <KebabMenu>
                    <DropdownItem
                        data-remove
                        onClick={() => remove_role(config, role.name)}
                        icon={<RhUiTrashIcon />}
                        isDanger
                    >
                        {_("Remove")}
                    </DropdownItem>
                </KebabMenu>
            </Td>
        </Tr>
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
    const [selectedRole, setSelectedRole] = useState<string>("");

    function add_role() {
        const config_roles = config.config.roles.map(r => r.name);
        Dialogs.show(
            <AddRoleDialog
                config={config}
                roles={roles}
                filter={role => !config_roles.includes(role.name)}
            />);
    }

    const actions = (
        <Button
            id="add-role"
            onClick={add_role}
        >
            {_("Add System Role")}
        </Button>
    );

    const selectedRoleConfig = selectedRole && config.config.roles.find(r => r.name === selectedRole);

    return (
        <Card id="configured-roles">
            <CardHeader actions={{ actions }}>
                <CardTitle>{_("System Roles")}</CardTitle>
            </CardHeader>
                <Split>
                    <SplitItem style={{ width: "30%", borderInlineEnd: "solid grey 1px" }}>
                        <Table>
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
                                                    isSelected={r === selectedRoleConfig}
                                                    onSelect={() => setSelectedRole(r.name)}
                                                />
                                            );
                                        else
                                            return null;
                                    }
                                )
                            }
                        </Table>
                    </SplitItem>
                    <SplitItem style={{ width: "70%", paddingInline: "1em" }}>
                        { selectedRoleConfig
                            ? (
                                <RolePanel
                                    config={config}
                                    role={selectedRoleConfig}
                                    system_role={roles[selectedRoleConfig.name]}
                                />
                            )
                            : (
                                <EmptyState>
                                    {_("Select a role to edit its variables.")}
                                </EmptyState>
                            )
                        }
                    </SplitItem>
                </Split>
        </Card>
    );
};

const MainSection = ({
    config,
    config_error,
    roles,
    roles_error,
} : {
    config: AppConfig | null,
    roles: SystemRoles | null,
    config_error: unknown,
    roles_error: unknown,
}) => {
    if (superuser.allowed === false)
        return (
            <EmptyState>
                {_("Administrative access needed.")}
            </EmptyState>
        );

    if (config_error)
        return (
            <EmptyState>
                {cockpit.format(_("Can't load configuration: $0"), String(config_error))}
            </EmptyState>
        );

    if (roles_error)
        return (
            <EmptyState>
                {cockpit.format(_("Can't load system roles: $0"), String(roles_error))}
            </EmptyState>
        );

    if (!config || !roles)
        return (
            <Bullseye>
                <Spinner />
            </Bullseye>
        );

    return (
        <>
            <ConfiguredRoles config={config} roles={roles} />
            <PlaybookExecution config={config} system_roles={roles} />
        </>
    );
};

export const Application = () => {
    const { config, error: config_error } = useAppConfig();
    const { roles, error: roles_error } = useSystemRoles();

    return (
        <WithDialogs>
            <ToastArea />
            <Page className='pf-m-no-sidebar'>
                <PageSection hasBodyWrapper={false} isFilled hasOverflowScroll>
                    <MainSection
                        config={config}
                        config_error={config_error}
                        roles={roles}
                        roles_error={roles_error}
                    />
                </PageSection>
            </Page>
        </WithDialogs>
    );
};
