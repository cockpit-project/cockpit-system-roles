/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import { JsonValue } from 'cockpit';
import { useState, useEffect } from "react";
import * as python from "python";
import {
    validate,
    import_json_object, import_record, import_array, import_string,
    get, get_optional
} from 'import-json';

import discover_system_roles_py from "./discover-system-roles.py";

/* SYSTEM ROLES

   We present the user with a lot of data about the system roles that
   they are putting into their playbook.  This data is read from two
   files.

       /usr/share/ansible/roles/<role>/meta/main.yml
       /usr/share/ansible/roles/<role>/meta/argument_specs.yml

   The format of these files is specified by Ansible and we encode it
   as TypeScript interfaces below.  But only the pieces we care about,
   of course.

   The arguments_spec.yml format is documented here, and maybe elsewhere:

       https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse_roles.html#role-argument-spec
       https://docs.ansible.com/projects/ansible/latest/dev_guide/developing_program_flow_modules.html#argument-spec
       https://github.com/ansible/ansible-lint/blob/main/src/ansiblelint/schemas/role-arg-spec.json

   The roles are found in the filesystem and turned into JSON by a
   very small Python script since that seems to be the easiest way to
   parse YAML for us.

   This discovery is done only once on application startup. If the
   installed roles change, the user needs to reload the browser.
 */

interface GalaxyInfo {
    description: string | undefined;
}

interface Meta {
    galaxy_info: GalaxyInfo | undefined;
}

export interface Option {
    type: string | undefined,
    description: string | string[] | undefined,
    default: JsonValue | undefined,
    choices: string[] | undefined,
}

interface ArgumentSpecs {
    options: Record<string, Option> | undefined,
}

interface Arguments {
    argument_specs: Record<string, ArgumentSpecs> | undefined,
}

export interface SystemRole {
    name: string,
    meta: Meta | undefined,
    arguments: Arguments | undefined,
}

function import_string_or_string_array(val: JsonValue): string | string[] {
    if (Array.isArray(val))
        return import_array(val, import_string);
    else
        return import_string(val);
}

function import_GalaxyInfo(val: JsonValue): GalaxyInfo {
    const obj = import_json_object(val);
    return {
        description: get_optional(obj, "description", import_string),
    };
}

function import_Meta(val: JsonValue): Meta {
    const obj = import_json_object(val);
    return {
        galaxy_info: get_optional(obj, "galaxy_info", import_GalaxyInfo),
    }
}

function import_Option(val: JsonValue): Option {
    const obj = import_json_object(val);
    return {
        type: get_optional(obj, "type", import_string),
        description: get_optional(obj, "description", import_string_or_string_array),
        default: get_optional(obj, "default", v => v),
        choices: get_optional(obj, "choices", v => import_array(v, import_string)),
    }
}

function import_ArgumentSpecs(val: JsonValue): ArgumentSpecs {
    const obj = import_json_object(val);
    return {
        options: get_optional(obj, "options", v => import_record(v, import_Option)),
    };
}

function import_Arguments(val: JsonValue): Arguments {
    const obj = import_json_object(val);
    return {
        argument_specs: get_optional(obj, "argument_specs", v => import_record(v, import_ArgumentSpecs)),
    }
}

function import_SystemRole(val: JsonValue): SystemRole {
    const obj = import_json_object(val);
    return {
        name: get(obj, "name", import_string),
        meta: get_optional(obj, "meta", import_Meta),
        arguments: get_optional(obj, "arguments", import_Arguments),
    };
}

interface DiscoverResult {
    roles: {
        name: string,
        meta: JsonValue,
        arguments: JsonValue,
    }[],
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
                    const roles = result.roles.map(r => validate(r.name, r, import_SystemRole, null))
                    setRoles(Object.fromEntries(roles.filter(r => !!r).map(r => [r.name, r])));
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
