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
import { Card, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card';
import { Table, Tbody, Tr, Td } from '@patternfly/react-table';
import { Bullseye } from '@patternfly/react-core/dist/esm/layouts/Bullseye';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner';
import { EmptyState, EmptyStateBody } from '@patternfly/react-core/dist/esm/components/EmptyState';
import { Button } from '@patternfly/react-core/dist/esm/components/Button';
import { RhUiTrashIcon, RhUiExternalLinkIcon, RhUiAddCircleIcon } from '@patternfly/react-icons';
import { Modal, ModalBody, ModalHeader, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal';
import { Switch } from '@patternfly/react-core/dist/esm/components/Switch';
import { DropdownItem } from '@patternfly/react-core/dist/esm/components/Dropdown';
import { Divider } from '@patternfly/react-core/dist/esm/components/Divider';
import { Title } from '@patternfly/react-core/dist/esm/components/Title';
import { Label, LabelStatus } from '@patternfly/react-core/dist/esm/components/Label';

import { shortenstart, short_role_name, Description, KebabMenu, TwoResizableColumns } from "./utils";
import { ToastArea } from "./toaster";
import { useAppConfig, AppConfig, RoleConfig, add_roles, remove_role, enable_role } from "./config";
import { useSystemRoles, SystemRole, SystemRoles, Option } from "./roles";
import { PlaybookExecution } from "./run";
import { EditVariable, validate_role } from "./edit";
import { Form, FormGroup, FormHelperText } from '@patternfly/react-core/dist/esm/components/Form';
import { HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/HelperText';

const _ = cockpit.gettext;

superuser.reload_page_on_change();

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
    const [selectedRoles, setSelectedRoles] = useState<Set<string>>(() => new Set());

    function toggleRole(name: string) {
        setSelectedRoles(sel => {
            const newSel = new Set(sel);
            if (newSel.has(name))
                newSel.delete(name);
            else
                newSel.add(name);
            return newSel;
        })
    }

    const useableRoles =
        Object.values(roles)
            .filter(r => r.arguments?.argument_specs?.main?.options);

    const availableRoles = useableRoles.filter(filter);

    let body;
    if (availableRoles.length > 0) {
        body = (
            <Table>
                <Tbody>
                    {
                        availableRoles.map(
                            (role, index) => {
                                return (
                                    <Tr
                                        key={role.name}
                                        isClickable
                                        onRowClick={() => toggleRole(role.name)}
                                    >
                                        <Td
                                            select={
                                                {
                                                    isSelected: selectedRoles.has(role.name),
                                                    rowIndex: index
                                                }
                                            }
                                        />
                                        <Td>{role.name}</Td>
                                        <Td>{role.meta?.galaxy_info?.description}</Td>
                                    </Tr>
                                );
                            }
                        )
                    }
                </Tbody>
            </Table>
        );
    } else {
        body = (
            <EmptyState>
                <EmptyStateBody>
                    {
                        useableRoles.length === 0
                            ? _("No system roles available")
                            : _("All system roles have already been added")
                    }
                </EmptyStateBody>
            </EmptyState>
        );
    }

    return (
        <Modal
            id="add-role-modal"
            isOpen
            variant="medium"
            position="top"
            onClose={Dialogs.close}
        >
            <ModalHeader title="Add System Roles" />
            <ModalBody>
                { body }
            </ModalBody>
            <ModalFooter>
                <Button
                    variant="primary"
                    isAriaDisabled={availableRoles.length === 0 || selectedRoles.size === 0}
                    onClick={
                        async () => {
                            await add_roles(config, [...selectedRoles.values()]);
                            Dialogs.close();
                        }
                    }
                >
                    {_("Add roles")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};

const RemoveRoleDialog = ({
    config,
    name,
} : {
    config: AppConfig,
    name: string,
}) => {
    const Dialogs = useDialogs();

    return (
        <Modal
            id="remove-role-modal"
            isOpen
            variant="medium"
            position="top"
            onClose={Dialogs.close}
        >
            <ModalHeader
                title={cockpit.format(_("Permanently remove system role $0?"), short_role_name(name))}
                titleIconVariant="danger"
            />
            <ModalBody>
                {_("Removing a system role will lose all its variable settings.")}
            </ModalBody>
            <ModalFooter>
                <Button
                    variant="danger"
                    onClick={
                        () => {
                            // Error comes via a toast
                            remove_role(config, name);
                            Dialogs.close();
                        }
                    }
                >
                    {_("Remove role")}
                </Button>
                <Button
                    variant="link"
                    onClick={Dialogs.close}
                >
                    {_("Cancel")}
                </Button>
            </ModalFooter>
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
    const short_name = short_role_name(role.name);
    return (
        <FormGroup
            data-var={name}
            label={shortenstart(short_name + "_", name)}
            labelInfo={"(" + (spec.type || "str") + ")"}
        >
            <EditVariable
                config={config}
                role={role}
                name={name}
                spec={spec}
            />
            <FormHelperText>
                <HelperText>
                    <HelperTextItem>
                        <Description>
                            {spec.description}
                        </Description>
                    </HelperTextItem>
                </HelperText>
            </FormHelperText>
        </FormGroup>
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
        <div id="role-edit">
            <Title headingLevel="h2">
                {short_role_name(role.name)}
            </Title>
            <Description>
                {system_role.meta?.galaxy_info?.description}
            </Description>
            <br />
            <Form isHorizontal className="ct-wide-form">
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
            </Form>
            <br />
        </div>
    );
};

const RoleRow = ({
    config,
    role,
    system_roles,
    isSelected,
    onSelect,
} : {
    config: AppConfig,
    role: RoleConfig,
    system_roles: SystemRoles,
    isSelected: boolean,
    onSelect: () => void,
}) => {
    const Dialogs = useDialogs();
    const short_name = short_role_name(role.name);

    return (
        <Tr
            isSelectable
            isClickable
            isRowSelected={isSelected}
            data-role={role.name}
            aria-label={isSelected ? `Selected system role, ${short_name}` : short_name}
        >
            <Td modifier="fitContent">
                <Switch
                    isChecked={!!role.enabled}
                    onChange={
                        (_event, val) => {
                            enable_role(config, role.name, val);
                        }
                    }
                    aria-label={short_name}
                />
            </Td>
            <Td
                onClick={onSelect}
            >
                <b>{short_name}</b>
            </Td>
            <Td modifier="fitContent">
                {
                    // HACK - we keep this always in the DOM so that
                    // the row height doesn't change when it should be
                    // visible.
                    //
                    // XXX - dtrt for aria
                }
                <Label
                    style={{ visibility: validate_role(role, system_roles) ? "hidden" : "visible" }}
                    variant="outline"
                    status={LabelStatus.danger}
                >
                    {_("Invalid parameter values")}
                </Label>
            </Td>
            <Td modifier="fitContent" hasAction>
                <KebabMenu
                    ariaLabel={_("Role actions")}
                >
                    <DropdownItem
                        data-read-more
                        target="_blank"
                        rel="noopener noreferrer"
                        to={`https://galaxy.ansible.com/ui/standalone/roles/linux-system-roles/${short_name}/documentation/`}
                        icon={<RhUiExternalLinkIcon />}
                    >
                        {_("Read more")}
                    </DropdownItem>
                    <Divider />
                    <DropdownItem
                        data-remove
                        onClick={
                            () => {
                                Dialogs.show(<RemoveRoleDialog config={config} name={role.name} />);
                            }
                        }
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
            icon={<RhUiAddCircleIcon />}
            onClick={add_role}
        >
            {_("Add System Roles")}
        </Button>
    );

    const selectedRoleConfig = config.config.roles.find(r => r.name === selectedRole) || config.config.roles[0];

    return (
        <Card id="configured-roles">
            <CardHeader actions={{ actions }}>
                <CardTitle>{_("System Roles")}</CardTitle>
            </CardHeader>
            <TwoResizableColumns>
                <Table>
                    <Tbody>
                        {
                            config.config.roles.map(
                                role => {
                                    if (roles[role.name]) {
                                        return (
                                            <RoleRow
                                                config={config}
                                                key={role.name}
                                                role={role}
                                                system_roles={roles}
                                                isSelected={role === selectedRoleConfig}
                                                onSelect={() => setSelectedRole(role.name)}
                                            />
                                        );
                                    } else {
                                        return null;
                                    }
                                }
                            )
                        }
                    </Tbody>
                </Table>
                {
                    selectedRoleConfig && roles[selectedRoleConfig.name]
                        ? (
                            <RolePanel
                                config={config}
                                role={selectedRoleConfig}
                                system_role={roles[selectedRoleConfig.name]}
                            />
                        )
                        : null
                }
            </TwoResizableColumns>
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
