/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React, { useState, useEffect, useRef } from 'react';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput';
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox';
import { SimpleSelect } from 'cockpit-components-simple-select';
import { Switch } from '@patternfly/react-core/dist/esm/components/Switch';
import { HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/HelperText';
import { FileChooserInput } from 'cockpit/react/FileChooser';

import { AppConfig, RoleConfig } from "./config";
import { Option } from "./discover";

const _ = cockpit.gettext;

/* Defaults:

   - config stores variable values in JSON form

   - empty string means, not set in playbook

   - if there is a default, the Ui translates between unset vars and
     that default both ways

   - if there is no default, there is a checkbox for explicitly
     putting a var into the playbook. it is off when var is unset,
     when checking it, a reasonable value is put into the var, like
     the empty string, the number zero, the first choice, false.

   - for "raw" (and "int"), the user might empty out the text
     input. Inthat case we shouldn't change that to the default, and
     thus fight the user.  Instead, the default is shown as a
     placeholder when the input is empty.
 */

const DebouncedTextInput = ({
    value,
    onChange,
    placeholder,
} : {
    value: string,
    onChange: (val: string) => void,
    placeholder?: string,
}) => {
    const [localValue, setLocalValue] = useState<string>(value);
    const timer = useRef<number>(0);

    useEffect(
        () => {
            setLocalValue(value);
        },
        [value],
    );

    return (
        <TextInput
            value={localValue}
            onChange={
                (_event, val) => {
                    setLocalValue(val);
                    if (timer.current)
                        window.clearTimeout(timer.current);
                    timer.current = window.setTimeout(
                        () => {
                            timer.current = 0;
                            onChange(val);
                        },
                        500);
                }
            }
            {...placeholder ? { placeholder } : {}}
        />
    );
};

function update_variable(config: AppConfig, role: RoleConfig, name: string, value: string) {
    try {
        // XXX - remove completely when value == ""
        config.modify(
            conf => {
                return {
                    ...conf,
                    roles: conf.roles.map(
                        r =>
                            Object.is(r, role)
                                ? {
                                    ...r,
                                    vars: {
                                        ...r.vars,
                                        [name]: { value } // XXX - keep rest
                                    }
                                }
                                : r
                    )
                };
            }
        );
    } catch (ex) {
        // XXX - error toast
        console.log("Failed to update", ex);
    }
}

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
            value={value.substring(1, value.length - 1)}
            onChange={val => update('"' + val + '"')}
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
            selected={value.substring(1, value.length - 1)}
            options={choices.map(c => ({ value: c, content: c }))}
            onSelect={val => update('"' + val + '"')}
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
    return (
        <Switch
            isChecked={value === "true"}
            label={value === "true" ? _("True") : _("False")}
            onChange={(_event, val) => update(val ? "true" : "false")}
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
        <FileChooserInput
            value={value.substring(1, value.length - 1)}
            onChange={
                (val, /* fromDialog */) => {
                    // XXX - debounce when not from dialog
                    update('"' + val + '"');
                }
            }
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
    if (value === "")
        return;
    if (spec.type === "raw") {
        try {
            JSON.parse(value);
        } catch {
            return _("Must be valid JSON");
        }
    }
    if (spec.type === "int") {
        let val;
        try {
            val = JSON.parse(value);
        } catch {
            return _("Must be an integer");
        }
        if (!Number.isInteger(val))
            return _("Must be an integer");
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

    let value = (conf_v && conf_v.value) ? conf_v.value : "";

    let need_checkbox = false;
    let enabled = false;

    if (spec.default !== undefined) {
        if (!value && !(spec.type === "raw" || spec.type === "int"))
            value = JSON.stringify(spec.default);
    } else if (spec.type !== "raw") {
        need_checkbox = true;
        enabled = !!value;
    }

    function update(val: string) {
        if (spec.default !== undefined && !(spec.type === "raw" || spec.type === "int") && val === JSON.stringify(spec.default))
            val = "";
        update_variable(config, role, name, val);
    }

    let comp;

    if (spec.type === "str" && spec.choices)
        comp = <EditChoices value={value} update={update} choices={spec.choices} />;
    else if (spec.type === "str")
        comp = <EditStr value={value} update={update} />;
    else if (spec.type === "bool")
        comp = <EditBool value={value} update={update} />;
    else if (spec.type === "path")
        comp = <EditPath value={value} update={update} />;
    else if (spec.type === "int")
        comp = <EditRaw value={value} placeholder={JSON.stringify(spec.default)} update={update} />; // XXX - good enough for now
    else
        comp = <EditRaw value={value} placeholder={JSON.stringify(spec.default)} update={update} />;

    const error = validate_value(value, spec);
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
                            console.log("CHECKED", checked);
                            if (checked && !enabled) {
                                if (spec.type === "str" && spec.choices)
                                    update('"' + spec.choices[0] + '"');
                                else if (spec.type === "str")
                                    update("\"\"");
                                else if (spec.type === "bool")
                                    update("false");
                                else if (spec.type === "path")
                                    update("\"\"");
                                else if (spec.type === "int")
                                    update("0");
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
