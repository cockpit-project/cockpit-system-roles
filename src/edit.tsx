/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import cockpit from 'cockpit';
import React, { useState, useEffect, useRef } from 'react';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput';
import { SimpleSelect } from 'cockpit-components-simple-select';
import { Switch } from '@patternfly/react-core/dist/esm/components/Switch';
import { FileChooserInput } from 'cockpit/react/FileChooser';

import { AppConfig, RoleConfig } from "./config";
import { Option } from "./discover";

const _ = cockpit.gettext;

const DebouncedTextInput = ({
    value,
    onChange,
} : {
    value: string,
    onChange: (val: string) => void,
}) => {
    const [localValue, setLocalValue] = useState<string>(value);
    const timer = useRef<number>(0);

    useEffect(
        () => {
            setLocalValue(value);
        },
        [value],
    )

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
        />
    )
}

function update_variable(config: AppConfig, role: RoleConfig, name: string, value: string) {
    try {
        config.modify(
            conf => {
                return {
                    ...conf,
                    roles: conf.roles.map(
                        r =>
                            Object.is(r, role)
                                ?
                                {
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
    config,
    role,
    name,
} : {
    config: AppConfig,
    role: RoleConfig,
    name: string,
}) => {
    const conf_v = role.vars[name];

    return (
        <DebouncedTextInput
            value={conf_v ? conf_v.value : ""}
            onChange={val => update_variable(config, role, name, val)}
        />
    );
};

const EditStr = ({
    config,
    role,
    name,
} : {
    config: AppConfig,
    role: RoleConfig,
    name: string,
}) => {
    const conf_v = role.vars[name];

    return (
        <DebouncedTextInput
            value={conf_v ? conf_v.value.substring(1, conf_v.value.length - 1) : ""}
            onChange={val => update_variable(config, role, name, '"' + val + '"')}
        />
    );
}

const EditChoices = ({
    config,
    role,
    name,
    choices,
} : {
    config: AppConfig,
    role: RoleConfig,
    name: string,
    choices: string[],
}) => {
    const conf_v = role.vars[name];

    return (
        <SimpleSelect<string>
            selected={(conf_v && conf_v.value) ? conf_v.value.substring(1, conf_v.value.length - 1) : choices[0]}
            options={choices.map(c => ({ value: c, content: c }))}
            onSelect={val => update_variable(config, role, name, '"' + val + '"')}
        />
    );
}

const EditBool = ({
    config,
    role,
    name,
} : {
    config: AppConfig,
    role: RoleConfig,
    name: string,
}) => {
    const conf_v = role.vars[name];

    return (
        <Switch
            isChecked={conf_v ? conf_v.value == "true" : false}
            onChange={(_event, val) => update_variable(config, role, name, val ? "true" : "false")}
        />
    );
}

const EditPath = ({
    config,
    role,
    name,
} : {
    config: AppConfig,
    role: RoleConfig,
    name: string,
}) => {
    const conf_v = role.vars[name];

    return (
        <FileChooserInput
            value={conf_v ? conf_v.value.substring(1, conf_v.value.length - 1) : ""}
            onChange={
                (val, fromDialog) => {
                    // XXX - debounce when not from dialog
                    update_variable(config, role, name, '"' + val + '"')
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
    if (spec.type == "str" && spec.choices)
        return <EditChoices config={config} role={role} name={name} choices={spec.choices} />;
    if (spec.type == "str")
        return <EditStr config={config} role={role} name={name} />;
    if (spec.type == "bool")
        return <EditBool config={config} role={role} name={name} />;
    if (spec.type == "path")
        return <EditPath config={config} role={role} name={name} />;
    if (spec.type == "int")
        return <EditRaw config={config} role={role} name={name} />; // XXX - good enough for now

    return <EditRaw config={config} role={role} name={name} />;
}
