/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React, { useState } from 'react';
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox';
import { SimpleSelect } from 'cockpit-components-simple-select';
import { Switch } from '@patternfly/react-core/dist/esm/components/Switch';
import { HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/HelperText';
import { Split, SplitItem } from '@patternfly/react-core/dist/esm/layouts/Split';
import { Button } from '@patternfly/react-core/dist/esm/components/Button';
import { RhUiEditIcon } from '@patternfly/react-icons';
import { Modal, ModalBody, ModalHeader, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal';
import { TextArea } from '@patternfly/react-core/dist/esm/components/TextArea';
import { Content, ContentVariants } from '@patternfly/react-core/dist/esm/components/Content';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import * as python from "python";

import { useDialogs } from "dialogs";

import {
    JSON_parse_type,
    DebouncedTextInput, DebouncedFileChooserInput,
    useDebouncer,
    Description,
} from "./utils";
import { AppConfig, RoleConfig, update_variable } from "./config";
import { SystemRoles, Option } from "./roles";

import validate_yaml_py from "./validate-yaml.py";

const _ = cockpit.gettext;

/* EDITING VARIABLES

   We use different UIs for different types of variables.  A dropdown
   for strings with a limited set of choices and an on/off switch for
   booleans, for example.  If we don't have a specific UI for a type,
   we let the user edit the YAML representation in a dialog.  This
   dialog is the designated UI for type "raw", but it gets used also
   for "list" and "dict", etc.

   If we know the default value for a variable (see below), the UI
   will make it look as if the variable always has a value, even if it
   is actually omitted from the playbook.  If the variable is omitted,
   we show it with its default value instead, and let the user edit
   that.  Thus, we trust that using the default value for a variable
   is exactly the same as omitting it from the playbook. If that is
   not true, it's a bug in the role.

   Once the user has made the first edit, the variable will no longer
   be omitted from the playbook.  (There should be a explicit "Reset
   to default" action, but there isn't yet.)

   If we don't know the default value, we have to let the user
   explicitly specify whether or not the variable should be in the
   playbook.  This is done with an additional, ugly, checkbox.

   When the user edits raw YAML in a dialog, we only accept valid YAML
   before saving anything.  This means we can always construct a valid
   playbook.  But the empty string is valid YAML and means "null".
   Which in turn _probably_ causes the role to use its default.  This
   is a bit tricky, but we accept this complexity.
 */

/* A bit about how values travel through Ansible, especially "null"

   The value for a variable

   - is specified in a playbook (or not)
   - then it passes through argument validation without being changed,
   - then it might get a default value from defaults/*.yml,
   - and then it is used in some way by the role tasks.

   Generally, there is a difference between not specifying a variable
   and giving it the value "null", but it is complicated in practice.

   The argument validation step will not run for variables that have
   not been specified.  When a variable has value "null", this step
   runs and rejects that value for types like "bool" and "int", but
   allows it for type "str", since anything can be converted to a
   string.  This conversion is only done for checking, however. The
   next steps will still see "null".

   The default values in defaults/*.yml are used only when a variable
   is explicitly unspecified.  If it has been explicitly set to "null"
   in the playbook, any default for it in defaults/*.yml will be
   ignored, and it will arrive as "null" at the task.

   Note that defaults/*.yml can specify a default value that would not
   pass argument validation, and that will not be caught since
   argument validation runs before default substitution. We don't need
   to worry about that, and maybe some roles even use that as a
   feature.

   How a task reacts to unset vs "null" variables is probably up to
   the task.  When a unset variable is used during {{ }}
   interpolation, that's an error.

   When you use a variable of type "str" with a "| string" conversion
   in an interpolation and then give it the value "null" in the
   playbook, it will pass validation and be substituted as the string
   "None" in the interpolation template. It might be unexpected to see
   the Python rendering of "null" in your output, but it all makes
   sense according to the behavior described above.

   Many system roles have variables of type "str" and a default of
   "null".  The default is both declared in argument_specs, and in
   defaults/main.yml.  The value "null" as a default means "no default
   value" in practice since it is not a string.  Maybe the empty
   string has the same effect as "null", or maybe not.

   The following function encodes this to implement the predicate "do
   we know the default value".
 */

function has_default(spec: Option) {
    // "default: null" means "no default" for type "str" and is likely
    // an error for any other type except "raw".
    return spec.default !== undefined && (spec.type === "raw" || spec.default !== null);
}

const EditDirect = ({
    disabled,
    value,
    update,
} : {
    disabled: boolean,
    value: string,
    update: (val: string) => Promise<void>,
}) => {
    return (
        <DebouncedTextInput
            value={value}
            onChange={update}
            disabled={disabled}
        />
    );
};

interface YAMLMessage {
    message: string;
    line: number;
    column: number;
}

interface YAMLError {
    context?: YAMLMessage;
    problem?: YAMLMessage;
}

const YAMLMessageDetails = ({ msg } : { msg: YAMLMessage | undefined }) => {
    if (!msg || !msg.message)
        return null;

    return (
        <div>
            {msg.message}
            {"\n"}
            {msg.line >= 0 && cockpit.format(_("(line $0, column $1)"), msg.line + 1, msg.column + 1)}
        </div>
    );
};

const EditRawDialog = ({
    name,
    spec,
    value,
    update,
} : {
    name: string,
    spec: Option,
    value: string,
    update: (val: string) => Promise<void>,
}) => {
    const Dialogs = useDialogs();
    const [localValue, setLocalValue] = useState<string>(value);
    const [error, setError] = useState<React.ReactNode>(null);

    return (
        <Modal
            id="edit-raw-modal"
            isOpen
            variant="large"
            position="top"
            onClose={Dialogs.close}
        >
            <ModalHeader
                title={cockpit.format(_("Edit $0"), name)}
            />
            <ModalBody>
                {
                    error &&
                        <>
                            <Alert
                                ouiaId="dialog-error-message"
                                variant='danger'
                                isInline
                                title={_("Invalid YAML")}
                            >
                                {error}
                            </Alert>
                            <br />
                        </>
                }
                <Description>
                    {spec.description}
                </Description>
                <br />
                <Content component={ContentVariants.p}>
                    {_("Write YAML here.  Strings are subject to Jinja2 expansion.")}
                </Content>
                <TextArea
                    className="ct-monospace-textarea ct-big-textarea"
                    value={localValue}
                    resizeOrientation="vertical"
                    onChange={
                        (_event, value) => {
                            setError("");
                            setLocalValue(value);
                        }
                    }
                />

            </ModalBody>
            <ModalFooter>
                <Button
                    onClick={
                        async () => {
                            const err = await python.spawn(validate_yaml_py, [], { }).input(localValue);
                            if (err) {
                                const data = JSON.parse(err) as YAMLError;
                                setError(
                                    <>
                                        <YAMLMessageDetails msg={data.context} />
                                        <YAMLMessageDetails msg={data.problem} />
                                    </>
                                );
                                return;
                            }
                            update(localValue);
                            Dialogs.close();
                        }
                    }
                >
                    {_("Save")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};

const EditRaw = ({
    name,
    spec,
    value,
    update,
    disabled,
} : {
    name: string,
    spec: Option,
    value: string,
    update: (val: string) => Promise<void>,
    disabled: boolean,
}) => {
    const Dialogs = useDialogs();

    return (
        <Split className={disabled ? "ct-raw-value-disabled" : "ct-raw-value"}>
            <SplitItem isFilled>
                <Content component={ContentVariants.pre}>
                    {value}
                </Content>
            </SplitItem>
            <SplitItem>
                <Button
                    variant="plain"
                    icon={<RhUiEditIcon />}
                    isAriaDisabled={disabled}
                    onClick={
                        () => Dialogs.show(
                            <EditRawDialog
                                name={name}
                                spec={spec}
                                value={value}
                                update={update}
                            />
                        )
                    }
                />
            </SplitItem>
        </Split>
    );
};

const EditStr = ({
    value,
    update,
    disabled,
} : {
    value: string,
    update: (val: string) => Promise<void>,
    disabled: boolean,
}) => {
    return (
        <DebouncedTextInput
            value={JSON_parse_type(value, "")}
            onChange={val => update(JSON.stringify(val))}
            disabled={disabled}
        />
    );
};

const EditChoices = ({
    value,
    update,
    choices,
    disabled,
} : {
    value: string,
    update: (val: string) => Promise<void>,
    choices: string[],
    disabled: boolean,
}) => {
    // XXX - we use a debouncer to make the "Run" button wait for our update promise to settle...
    const debouncer = useDebouncer();

    return (
        <SimpleSelect<string>
            isDisabled={disabled}
            selected={JSON_parse_type(value, choices[0])}
            options={choices.map(c => ({ value: c, content: c }))}
            onSelect={
                val => {
                    debouncer.trigger(0, () => update(JSON.stringify(val)));
                }
            }
        />
    );
};

const EditBool = ({
    value,
    update,
    disabled,
} : {
    value: string,
    update: (val: string) => Promise<void>,
    disabled: boolean,
}) => {
    // XXX - we use a debouncer to make the "Run" button wait for our update promise to settle...
    const debouncer = useDebouncer();

    const v = JSON_parse_type(value, false);
    return (
        <Switch
            isDisabled={disabled}
            isChecked={v}
            label={v ? _("True") : _("False")}
            onChange={
                (_event, val) => {
                    debouncer.trigger(0, () => update(JSON.stringify(val)));
                }
            }
        />
    );
};

const EditPath = ({
    value,
    update,
    disabled,
} : {
    value: string,
    update: (val: string) => Promise<void>,
    disabled: boolean,
}) => {
    return (
        <DebouncedFileChooserInput
            disabled={disabled}
            value={JSON_parse_type(value, "")}
            onChange={val => update(JSON.stringify(val))}
            fileChooserProps={
                {
                    title: _("Select something"),
                    onlyDirectories: true,
                }
            }
        />
    );
};

function validate_value(value: string, spec: Option) {
    // We only need to validate variables that are edited via the
    // EditDirect component.  The rest are guaranteed to be valid by
    // construction.

    if (spec.type === "int") {
        const parsed = Number(value);
        if (value === "" || !Number.isInteger(parsed))
            return _("Must be an integer");
    } else if (spec.type === "float") {
        const parsed = Number(value);
        if (value === "" || Number.isNaN(parsed))
            return _("Must be a number");
    }
}

export const EditVariable = ({
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
    const conf_v = role.vars[name];

    let stored_value: string | undefined = conf_v?.value;
    const type = spec.type || "str";

    let displayed_value: string;
    if (stored_value === undefined) {
        // We always come up with a value to display.  For variables
        // with a default, it's the default.  Variables without a
        // default and without a value need to be explicitly enabled,
        // but we want to show the editing widget for them at all
        // times.  So we use something that is a reasonable starting
        // point for editing.

        if (has_default(spec)) {
            // For types with a specific editing widget, we need the
            // default as JSON since those widgets parse it as JSON.
            // For types that use EditRaw, we want it as YAML, since
            // giving the default to the user as JSON would be weird.

            const json_types = ["str", "int", "float", "bool", "path"];

            if (json_types.includes(type))
                displayed_value = JSON.stringify(spec.default);
            else
                displayed_value = spec.default_yaml || "";
        } else {
            if (type === "str" && spec.choices)
                displayed_value = JSON.stringify(spec.choices[0]);
            else if (type === "str")
                displayed_value = '""';
            else if (type === "bool")
                displayed_value = "false";
            else if (type === "path")
                displayed_value = '"\"';
            else
                displayed_value = "";
        }
    } else
        displayed_value = stored_value;

    const need_checkbox = !has_default(spec);
    const disabled = need_checkbox && (stored_value === undefined || !!conf_v?.disabled);

    async function update(val: string) {
        await update_variable(config, role.name, name, val, false);
    }

    let comp;
    if (type === "str" && spec.choices)
        comp = <EditChoices disabled={disabled} value={displayed_value} update={update} choices={spec.choices} />;
    else if (type === "str")
        comp = <EditStr disabled={disabled} value={displayed_value} update={update} />;
    else if (type === "bool")
        comp = <EditBool disabled={disabled} value={displayed_value} update={update} />;
    else if (type === "path")
        comp = <EditPath disabled={disabled} value={displayed_value} update={update} />;
    else if (type === "int") {
        comp = (
            <EditDirect
                disabled={disabled}
                value={displayed_value}
                update={update}
            />
        );
    } else if (type === "float") {
        comp = (
            <EditDirect
                disabled={disabled}
                value={displayed_value}
                update={update}
            />
        );
    } else {
        comp = (
            <EditRaw
                disabled={disabled}
                name={name}
                spec={spec}
                value={displayed_value}
                update={update}
            />
        );
    }

    let error;
    if (!disabled)
        error = validate_value(displayed_value, spec);

    let helper_text;
    if (error)
        helper_text = (
            <HelperText>
                <HelperTextItem variant="error">{error}</HelperTextItem>
            </HelperText>
        );

    if (need_checkbox) {
        comp = (
            <Split hasGutter>
                <SplitItem isFilled>
                    {comp}
                </SplitItem>
                <SplitItem>
                    <Switch
                        id={role.name + "/" + name}
                        isChecked={!disabled}
                        onChange={
                            (_event, checked) => {
                                if (checked) {
                                    update(displayed_value);
                                } else {
                                    update_variable(config, role.name, name, stored_value, true);
                                }
                            }
                        }
                    />
                </SplitItem>
            </Split>
        );
    }

    return (
        <>
            {comp}
            {helper_text}
        </>
    );
};

export function validate_role(role: RoleConfig, system_roles: SystemRoles) {
    if (!role.enabled)
        return true;
    const system_role = system_roles[role.name];
    return Object.entries(system_role.arguments?.argument_specs?.main?.options || {}).every(
        ([name, spec]) => {
            const conf_v = role.vars[name];
            const value: string | undefined = conf_v?.value;
            return value === undefined || conf_v?.disabled || (validate_value(value, spec) === undefined);
        }
    );
}

export function validate_all(config: AppConfig, system_roles: SystemRoles): boolean {
    return config.config.roles.every(role => validate_role(role, system_roles));
}
