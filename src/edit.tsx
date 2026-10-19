/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React from 'react';
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox';
import { SimpleSelect } from 'cockpit-components-simple-select';
import { Switch } from '@patternfly/react-core/dist/esm/components/Switch';
import { HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/HelperText';

import { JSON_parse_carefully, JSON_parse_type, DebouncedTextInput, DebouncedFileChooserInput } from "./utils";
import { AppConfig, RoleConfig, update_variable } from "./config";
import { Option } from "./roles";

const _ = cockpit.gettext;

/* EDITING VARIABLES

   We use different UIs for different types of variables.  A dropdown
   for strings with a limited set of choices and an on/off switch for
   booleans, for example.  If we don't have a specific UI for a type,
   we let the user edit the JSON representation in a text input.

   When the user edits raw JSON, leaving the text input empty means
   that the variable will not be included in the playbook at all.  If
   it is not empty, it must be valid JSON.  If it is not valid JSON,
   we can not construct the playbook at all (since the playbook itself
   wouldn't be valid JSON then), so we catch and point that out in the
   UI.

   If there is a default for a JSON text input, it is shown as a
   placeholder.

   When we _do_ have a specific UI for a type, defaults are handled
   differently.

   If we know the default value, the UI will make it look as if the
   variable always has a value, even if it is actually omitted from
   the playbook.  If the variable is omitted, we show it with its
   default value instead, and if the user edits it and makes it equal
   to the default value, we will omit it from the playbook.

   If we don't know the default value, we have to let the user
   explicitly specify whether or not the variable should be in the
   playbook.  This is done with an additional, ugly, checkbox.

   Note that there is no specific UI for "int" and "float" types.  If
   the UI for them would be a text input, it would behave identical to
   raw JSON.  We do additional validation, however, also for "dict"
   and "list".
 */

const EditRaw = ({
    value,
    update,
    placeholder,
} : {
    value: string,
    update: (val: string) => void,
    placeholder: string,
}) => {
    return (
        <DebouncedTextInput
            value={value}
            onChange={update}
            placeholder={placeholder}
        />
    );
};

const EditStr = ({
    value,
    update,
} : {
    value: string,
    update: (val: string) => void,
}) => {
    return (
        <DebouncedTextInput
            value={JSON_parse_type(value, "")}
            onChange={val => update(JSON.stringify(val))}
        />
    );
};

const EditChoices = ({
    value,
    update,
    choices,
} : {
    value: string,
    update: (val: string) => void,
    choices: string[],
}) => {
    return (
        <SimpleSelect<string>
            selected={JSON_parse_type(value, choices[0])}
            options={choices.map(c => ({ value: c, content: c }))}
            onSelect={val => update(JSON.stringify(val))}
        />
    );
};

const EditBool = ({
    value,
    update,
} : {
    value: string,
    update: (val: string) => void,
}) => {
    const v = JSON_parse_type(value, false);
    return (
        <Switch
            isChecked={v}
            label={v ? _("True") : _("False")}
            onChange={(_event, val) => update(JSON.stringify(val))}
        />
    );
};

const EditPath = ({
    value,
    update,
} : {
    value: string,
    update: (val: string) => void,
}) => {
    return (
        <DebouncedFileChooserInput
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

const specific_ui_types = ["str", "bool", "path"];

function validate_value(value: string, spec: Option) {
    if (value === "")
        return;

    if (specific_ui_types.includes(spec.type || "str")) {
        // No extra validation done yet.
        return;
    }

    // Rest must be JSON.
    let val;
    try {
        val = JSON.parse(value);
    } catch {
        return _("Must be valid JSON");
    }

    // Additional validation
    if (spec.type === "int" && !Number.isInteger(val))
        return _("Must be an integer");
    if (spec.type === "float" && typeof val !== "number")
        return _("Must be a number");
    if (spec.type === "list" && !Array.isArray(val))
        return _("Must be a JSON array");
    if (spec.type === "dict" && !(typeof val === "object" && !Array.isArray(val)))
        return _("Must be a JSON object");
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

    let value = (conf_v && conf_v.value) ? conf_v.value : "";
    const type = spec.type || "str";

    let need_checkbox = false;
    let enabled = false;

    if (specific_ui_types.includes(type)) {
        // Type-specific UI, we care about whether there is a default.
        if (spec.default !== undefined) {
            if (!value)
                value = JSON.stringify(spec.default);
        } else {
            need_checkbox = true;
            enabled = !!value;
        }
    }

    function update(val: string) {
        if (specific_ui_types.includes(type)) {
            if (spec.default !== undefined && JSON_parse_carefully(val) === spec.default)
                val = "";
        }
        update_variable(config, role, name, val);
    }

    let comp;

    if (type === "str" && spec.choices)
        comp = <EditChoices value={value} update={update} choices={spec.choices} />;
    else if (type === "str")
        comp = <EditStr value={value} update={update} />;
    else if (type === "bool")
        comp = <EditBool value={value} update={update} />;
    else if (type === "path")
        comp = <EditPath value={value} update={update} />;
    else
        comp = <EditRaw value={value} placeholder={JSON.stringify(spec.default)} update={update} />;

    const error = (!need_checkbox || enabled) && validate_value(value, spec);
    let helper_text;
    if (error)
        helper_text = (
            <HelperText>
                <HelperTextItem variant="error">{error}</HelperTextItem>
            </HelperText>
        );

    if (need_checkbox)
        return (
            <>
                <Checkbox
                    id={role.name + "/" + name}
                    label={_("Provide a value for this variable")}
                    isChecked={enabled}
                    onChange={
                        (_event, checked) => {
                            if (checked && !enabled) {
                                if (type === "str" && spec.choices)
                                    update('"' + spec.choices[0] + '"');
                                else if (type === "str")
                                    update("\"\"");
                                else if (type === "bool")
                                    update("false");
                                else if (type === "path")
                                    update("\"\"");
                                else
                                    update("");
                            } else if (!checked) {
                                update("");
                            }
                        }
                    }
                />
                <br />
                {enabled && comp}
                {helper_text}
            </>
        );
    else
        return (
            <>
                {comp}
                {helper_text}
            </>
        );
};
